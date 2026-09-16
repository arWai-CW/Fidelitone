/**
 * WAV file writer with PCM16 encoding.
 *
 * Converts Float32 audio channels to 16-bit PCM and packages them
 * into a standard WAV file blob.
 */

/**
 * Write audio channels as a PCM16 WAV blob.
 *
 * @param channels - Array of Float32Arrays, one per channel (samples in [-1, 1])
 * @param sampleRate - Sample rate in Hz (e.g. 44100, 48000)
 * @returns Blob of type 'audio/wav'
 */
export function writeWav(
  channels: Float32Array[],
  sampleRate: number
): Blob {
  const numChannels = channels.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;

  // Total frames (samples per channel)
  const numFrames = channels.length > 0 ? channels[0].length : 0;
  const totalSamples = numFrames * numChannels;
  const dataSize = totalSamples * bytesPerSample;
  const fileSize = 36 + dataSize;

  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;

  // Allocate buffer: 44-byte header + data
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header (12 bytes)
  writeString(view, 0, "RIFF");
  view.setUint32(4, fileSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk (24 bytes: 8 header + 16 data)
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk header (8 bytes)
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave and encode samples
  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = channels[ch][frame];
      // Clamp to [-1, 1] and scale to Int16 range
      const clamped = Math.max(-1, Math.min(1, sample));
      const int16 = Math.round(clamped * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Write ASCII string into DataView at given offset. */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
