function getBits(bytes, byteOffset, bitOffset, bitLength) {
  let value = 0;

  for (let bitIndex = 0; bitIndex < bitLength; bitIndex += 1) {
    const absoluteBitOffset = byteOffset * 8 + bitOffset + bitIndex;
    const currentByte = bytes[absoluteBitOffset >> 3];
    const currentBit = 7 - (absoluteBitOffset & 7);
    value = (value << 1) | ((currentByte >> currentBit) & 1);
  }

  return value;
}

function setBits(bytes, byteOffset, bitOffset, bitLength, value) {
  for (let bitIndex = 0; bitIndex < bitLength; bitIndex += 1) {
    const absoluteBitOffset = byteOffset * 8 + bitOffset + bitIndex;
    const byteIndex = absoluteBitOffset >> 3;
    const currentBit = 7 - (absoluteBitOffset & 7);
    const nextBit = (value >> (bitLength - bitIndex - 1)) & 1;

    if (nextBit) {
      bytes[byteIndex] |= 1 << currentBit;
    } else {
      bytes[byteIndex] &= ~(1 << currentBit);
    }
  }
}

function getId3TagSize(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return 0;
  }

  const tagSize =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return 10 + tagSize + ((bytes[5] & 0x10) !== 0 ? 10 : 0);
}

function parseMp3FrameHeader(bytes, frameOffset) {
  const byte2 = bytes[frameOffset + 1];
  const byte3 = bytes[frameOffset + 2];
  const byte4 = bytes[frameOffset + 3];

  if (bytes[frameOffset] !== 0xff || (byte2 & 0xe0) !== 0xe0) {
    return null;
  }

  const versionBits = (byte2 >> 3) & 0x03;
  const bitrateIndex = (byte3 >> 4) & 0x0f;
  const sampleRateIndex = (byte3 >> 2) & 0x03;

  if (versionBits === 0x01 || ((byte2 >> 1) & 0x03) !== 0x01 || bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) {
    return null;
  }

  const version = versionBits === 0x03 ? 1 : versionBits === 0x02 ? 2 : 2.5;
  const sampleRates = version === 1 ? [44100, 48000, 32000] : version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
  const bitrates = version === 1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const channels = (byte4 >> 6) === 0x03 ? 1 : 2;
  const frameLength = Math.floor(((version === 1 ? 144000 : 72000) * bitrates[bitrateIndex]) / sampleRates[sampleRateIndex] + ((byte3 >> 1) & 0x01));
  const sideInfoByteOffset = frameOffset + 4 + ((byte2 & 0x01) === 0 ? 2 : 0);
  const sideInfoSize = version === 1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;

  if (frameLength <= 0 || frameOffset + frameLength > bytes.length || sideInfoByteOffset + sideInfoSize > frameOffset + frameLength) {
    return null;
  }

  return {
    channelInfoBitLength: version === 1 ? 59 : 63,
    channelInfoStartBitOffset: version === 1 ? 9 + (channels === 1 ? 5 : 3) + channels * 4 : 8 + (channels === 1 ? 1 : 2),
    channels,
    frameLength,
    granules: version === 1 ? 2 : 1,
    sideInfoByteOffset,
  };
}

self.addEventListener('message', event => {
  const { buffer, gainStepDelta, requestId } = event.data;

  try {
    const bytes = new Uint8Array(buffer);
    let frameOffset = getId3TagSize(bytes);
    let changedFrameCount = 0;

    while (frameOffset + 4 <= bytes.length) {
      if (bytes.length - frameOffset === 128 && bytes[frameOffset] === 0x54 && bytes[frameOffset + 1] === 0x41 && bytes[frameOffset + 2] === 0x47) {
        break;
      }

      const frameHeader = parseMp3FrameHeader(bytes, frameOffset);

      if (!frameHeader) {
        break;
      }

      for (let granuleIndex = 0; granuleIndex < frameHeader.granules; granuleIndex += 1) {
        for (let channelIndex = 0; channelIndex < frameHeader.channels; channelIndex += 1) {
          const channelBitOffset = frameHeader.channelInfoStartBitOffset + (granuleIndex * frameHeader.channels + channelIndex) * frameHeader.channelInfoBitLength;
          const globalGainBitOffset = channelBitOffset + 21;
          const currentGlobalGain = getBits(bytes, frameHeader.sideInfoByteOffset, globalGainBitOffset, 8);
          const nextGlobalGain = Math.max(0, Math.min(255, currentGlobalGain + gainStepDelta));

          if (nextGlobalGain !== currentGlobalGain) {
            setBits(bytes, frameHeader.sideInfoByteOffset, globalGainBitOffset, 8, nextGlobalGain);
            changedFrameCount += 1;
          }
        }
      }

      frameOffset += frameHeader.frameLength;
    }

    self.postMessage({ buffer, changedFrameCount, requestId }, [buffer]);
  } catch (error) {
    self.postMessage({ error: error?.message || String(error), requestId });
  }
});
