const EMPTY_METADATA = Object.freeze({
  title: null,
  artist: null,
  artwork: null,
});

function readTextFrame(view, buffer, position, frameSize) {
  const encoding = view.getUint8(position);

  if (encoding === 0 || encoding === 3) {
    let text = '';

    for (let index = position + 1; index < position + frameSize; index += 1) {
      const code = view.getUint8(index);
      if (code === 0) {
        break;
      }
      text += String.fromCharCode(code);
    }

    return text;
  }

  if (encoding === 1) {
    const decoder = new TextDecoder('utf-16le');
    return decoder
      .decode(new Uint8Array(buffer, position + 3, frameSize - 3))
      .replace(/\0.*$/, '');
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
          const frameSize = view.getUint32(position + 4);

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
