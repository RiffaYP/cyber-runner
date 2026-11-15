const ID3_READ_BYTES = 256 * 1024

function decodeId3Text(bytes, encoding) {
  if (!bytes.length) return ''

  let text
  if (encoding === 0) {
    text = String.fromCharCode(...bytes)
  } else if (encoding === 3) {
    text = new TextDecoder('utf-8').decode(bytes)
  } else {
    if (encoding === 2) {
      const swapped = new Uint8Array(bytes.length)
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        swapped[i] = bytes[i + 1]
        swapped[i + 1] = bytes[i]
      }
      text = new TextDecoder('utf-16le').decode(swapped)
    } else {
      text = new TextDecoder('utf-16le').decode(bytes)
    }
  }
  return text.replace(/^\uFEFF/, '').replace(/\0+$/, '').trim()
}

function cleanTagText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

export async function readId3Tags(file) {
  if (!file || !/\.mp3$/i.test(file.name)) return {}

  let bytes
  try {
    const head = new Uint8Array(await file.slice(0, ID3_READ_BYTES).arrayBuffer())
    bytes = head
  } catch {
    return {}
  }

  const result = {}

  // ID3v2
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const major = bytes[3]
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f)

    const body = bytes.subarray(10, Math.min(10 + size, bytes.length))
    const idLength = major === 2 ? 3 : 4
    const headerLength = major === 2 ? 6 : 10

    let offset = 0
    while (offset + headerLength <= body.length) {
      const id = String.fromCharCode(...body.subarray(offset, offset + idLength))
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break

      const frameSize =
        major === 2
          ? (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5]
          : major === 3
            ? (body[offset + 4] << 24) |
              (body[offset + 5] << 16) |
              (body[offset + 6] << 8) |
              body[offset + 7]
            : ((body[offset + 4] & 0x7f) << 21) |
              ((body[offset + 5] & 0x7f) << 14) |
              ((body[offset + 6] & 0x7f) << 7) |
              (body[offset + 7] & 0x7f)

      if (frameSize <= 0) break

      const dataStart = offset + headerLength
      const dataEnd = Math.min(dataStart + frameSize, body.length)
      const data = body.subarray(dataStart, dataEnd)

      const isTitle = id === 'TIT2' || id === 'TT2'
      const isArtist = id === 'TPE1' || id === 'TP1'
      const isAlbum = id === 'TALB' || id === 'TAL'

      if (data.length > 1 && (isTitle || isArtist || isAlbum)) {
        const text = cleanTagText(decodeId3Text(data.subarray(1), data[0]))
        if (text) {
          if (isTitle && !result.title) result.title = text
          if (isArtist && !result.artist) result.artist = text
          if (isAlbum && !result.album) result.album = text
        }
      }

      offset = dataEnd
    }
  }

  // ID3v1 fallback
  if (!result.title || !result.artist) {
    try {
      const tail = new Uint8Array(await file.slice(-128).arrayBuffer())
      const isV1 =
        tail.length === 128 && tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47
      if (isV1) {
        const decode = (from, to) =>
          cleanTagText(new TextDecoder('iso-8859-1').decode(tail.subarray(from, to)))
        if (!result.title) result.title = decode(3, 33)
        if (!result.artist) result.artist = decode(33, 63)
        if (!result.album) result.album = decode(63, 93)
      }
    } catch {
      // Ignore: unreadable tail
    }
  }

  return result
}
