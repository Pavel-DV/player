const EMPTY_METADATA = Object.freeze({
  title: null,
  artist: null,
  artwork: null,
});

function trimNullTerminator(text) {
  return typeof text === 'string' ? text.replace(/\0.*$/, '') : '';
}

function decodeLatin1(bytes) {
  // Avoid relying on TextDecoder('iso-8859-1') support differences.
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0) break;
    text += String.fromCharCode(b);
  }
  return text;
}

function readTextFrame(view, buffer, position, frameSize) {
  const encoding = view.getUint8(position);

  const bytes = new Uint8Array(buffer, position + 1, Math.max(0, frameSize - 1));

  if (encoding === 3) {
    // ID3v2: encoding 3 = UTF-8
    try {
      return trimNullTerminator(new TextDecoder('utf-8').decode(bytes));
    } catch {
      return trimNullTerminator(decodeLatin1(bytes));
    }
  }

  if (encoding === 0) {
    // ID3v2: encoding 0 = ISO-8859-1
    return trimNullTerminator(decodeLatin1(bytes));
  }

  if (encoding === 1) {
    // ID3v2: encoding 1 = UTF-16 with BOM (some tags omit BOM).
    const bom1 = view.getUint8(position + 1);
    const bom2 = view.getUint8(position + 2);
    const hasBom = frameSize >= 3;
    const useBigEndian = hasBom && bom1 === 0xfe && bom2 === 0xff;
    const useLittleEndian = hasBom && bom1 === 0xff && bom2 === 0xfe;
    const decoder = new TextDecoder(useBigEndian ? 'utf-16be' : 'utf-16le');
    const start = position + (useBigEndian || useLittleEndian ? 3 : 1);
    const len = Math.max(0, position + frameSize - start);
    return trimNullTerminator(decoder.decode(new Uint8Array(buffer, start, len)));
  }

  if (encoding === 2) {
    // ID3v2: encoding 2 = UTF-16BE without BOM
    try {
      return trimNullTerminator(new TextDecoder('utf-16be').decode(bytes));
    } catch {
      // If utf-16be isn't supported, fall back (best-effort) to utf-16le.
      return trimNullTerminator(new TextDecoder('utf-16le').decode(bytes));
    }
  }

  return '';
}

function readArtworkFrame(view, buffer, position, frameSize) {
  try {
    let offset = position + 1;
    let mimeType = '';

    while (offset < position + frameSize && view.getUint8(offset) !== 0) {
      mimeType += String.fromCharCode(view.getUint8(offset));
      offset += 1;
    }

    offset += 1;
    offset += 1;

    while (offset < position + frameSize && view.getUint8(offset) !== 0) {
      offset += 1;
    }

    offset += 1;

    const imageData = new Uint8Array(
      buffer,
      offset,
      position + frameSize - offset
    );
    let binary = '';
    const chunkSize = 8192;

    for (let index = 0; index < imageData.length; index += chunkSize) {
      binary += String.fromCharCode(
        ...imageData.subarray(index, index + chunkSize)
      );
    }

    return `data:${mimeType || 'image/jpeg'};base64,${window.btoa(binary)}`;
  } catch (error) {
    console.warn('Failed to parse APIC frame:', error);
    return null;
  }
}

export function createMetadataReader({ getFileKey }) {
  const cache = new Map();

  async function extractMetadata(file) {
    const key = getFileKey(file);

    if (cache.has(key)) {
      return cache.get(key);
    }

    try {
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);
      const metadata = { ...EMPTY_METADATA };

      if (
        view.byteLength > 10 &&
        view.getUint8(0) === 0x49 &&
        view.getUint8(1) === 0x44 &&
        view.getUint8(2) === 0x33
      ) {
        const size =
          ((view.getUint8(6) & 0x7f) << 21) |
          ((view.getUint8(7) & 0x7f) << 14) |
          ((view.getUint8(8) & 0x7f) << 7) |
          (view.getUint8(9) & 0x7f);
        let position = 10;
        const end = Math.min(10 + size, view.byteLength);

        while (position + 10 < end) {
          const frameId = String.fromCharCode(
            view.getUint8(position),
            view.getUint8(position + 1),
            view.getUint8(position + 2),
            view.getUint8(position + 3)
          );
          const frameSize = view.getUint8(3) === 4
            ? ((view.getUint8(position + 4) & 0x7f) << 21) |
              ((view.getUint8(position + 5) & 0x7f) << 14) |
              ((view.getUint8(position + 6) & 0x7f) << 7) |
              (view.getUint8(position + 7) & 0x7f)
            : view.getUint32(position + 4);

          position += 10;

          if (frameSize === 0 || position + frameSize > end) {
            break;
          }

          if (frameId === 'TIT2' || frameId === 'TPE1') {
            const text = readTextFrame(view, buffer, position, frameSize);

            if (frameId === 'TIT2') {
              metadata.title = text;
            }

            if (frameId === 'TPE1') {
              metadata.artist = text;
            }
          } else if (frameId === 'APIC') {
            metadata.artwork = readArtworkFrame(
              view,
              buffer,
              position,
              frameSize
            );
          }

          position += frameSize;
        }
      }

      cache.set(key, metadata);
      return metadata;
    } catch (error) {
      console.warn(`Failed to extract metadata for "${key}":`, error);
      return { ...EMPTY_METADATA };
    }
  }

  return {
    extractMetadata,
  };
}
