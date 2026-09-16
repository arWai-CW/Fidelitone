/**
 * Opus encoder via WebCodecs AudioEncoder.
 *
 * Encodes Float32 audio channels to Opus in a WebM container.
 * Falls back to null when WebCodecs AudioEncoder is unavailable.
 */

/**
 * Encode audio channels as Opus in a WebM blob.
 *
 * @param channels - Array of Float32Arrays, one per channel (samples in [-1, 1])
 * @param sampleRate - Sample rate in Hz (e.g. 44100, 48000)
 * @returns Blob of type 'audio/webm', or null if AudioEncoder unavailable
 */
export async function encodeOpus(
  channels: Float32Array[],
  sampleRate: number
): Promise<Blob | null> {
  if (typeof AudioEncoder === "undefined") return null;

  const numChannels = channels.length;
  const numFrames = channels.length > 0 ? channels[0].length : 0;
  if (numFrames === 0) return null;

  const chunks: EncodedAudioChunk[] = [];

  const encoder = new AudioEncoder({
    output: (chunk) => chunks.push(chunk),
    error: (e) => console.error("AudioEncoder error:", e),
  });

  try {
    encoder.configure({
      codec: "opus",
      sampleRate,
      numberOfChannels: numChannels,
    });

    // Encode in 1024-sample frames (Opus frame size)
    const frameSize = 1024;
    for (let offset = 0; offset < numFrames; offset += frameSize) {
      const length = Math.min(frameSize, numFrames - offset);
      const planeData = new Float32Array(length * numChannels);

      // Interleave channels
      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          planeData[i * numChannels + ch] = channels[ch][offset + i];
        }
      }

      const data = new AudioData({
        format: "f32",
        sampleRate,
        numberOfFrames: length,
        numberOfChannels: numChannels,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: planeData,
      });

      encoder.encode(data);
      data.close();
    }

    await encoder.flush();

    if (chunks.length === 0) return null;

    // Concatenate chunk data into single Blob
    const buffers = chunks.map((c) => c.byteLength);
    const totalLen = buffers.reduce((a, b) => a + b, 0);
    const merged = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of chunks) {
      const copy = new Uint8Array(chunk.byteLength);
      chunk.copyTo(copy);
      merged.set(copy, pos);
      pos += copy.length;
    }

    return new Blob([merged], { type: "audio/webm" });
  } catch (e) {
    console.error("Opus encode failed:", e);
    return null;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}
