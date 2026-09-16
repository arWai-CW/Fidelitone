import { describe, it, expect } from "vitest";
import { writeWav } from "../lib/wav-writer";

describe("writeWav", () => {
  async function wavBytes(channels: Float32Array[], sr: number): Promise<Uint8Array> {
    const blob = writeWav(channels, sr);
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }

  it("RIFF header bytes are correct", async () => {
    const data = new Float32Array([0, 0.5, -0.5, 0]);
    const bytes = await wavBytes([data], 44100);

    // "RIFF"
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46]));
    // "WAVE" at offset 8
    expect(bytes.slice(8, 12)).toEqual(new Uint8Array([0x57, 0x41, 0x56, 0x45]));
    // "fmt " at offset 12
    expect(bytes.slice(12, 16)).toEqual(new Uint8Array([0x66, 0x6d, 0x74, 0x20]));
  });

  it("file size matches formula: 44 + samples × channels × 2", async () => {
    const frames = 100;
    const channels = 2;
    const data = [new Float32Array(frames), new Float32Array(frames)];
    const bytes = await wavBytes(data, 48000);

    const expectedSize = 44 + frames * channels * 2;
    expect(bytes.length).toBe(expectedSize);
  });

  it("PCM16 clamps and encodes correctly", async () => {
    // 3 samples: +1.0 (clamped), -1.0 (clamped), 0.0
    const input = new Float32Array([1.0, -1.0, 0.0]);
    const bytes = await wavBytes([input], 44100);

    const view = new DataView(bytes.buffer);

    // Data starts at byte 44. Each sample is Int16LE.
    const s0 = view.getInt16(44, true);
    const s1 = view.getInt16(46, true);
    const s2 = view.getInt16(48, true);

    expect(s0).toBe(32767); // 1.0 × 0x7fff → 32767
    expect(s1).toBe(-32767); // -1.0 × 0x7fff → -32767
    expect(s2).toBe(0); // 0.0 → 0
  });

  it("handles stereo interleaving", async () => {
    const left = new Float32Array([0.5, -0.5]);
    const right = new Float32Array([-0.5, 0.5]);
    const bytes = await wavBytes([left, right], 44100);

    const view = new DataView(bytes.buffer);

    // Frame 0: L=0.5, R=-0.5
    const f0l = view.getInt16(44, true);
    const f0r = view.getInt16(46, true);
    expect(f0l).toBe(16384); // 0.5 × 0x7fff → 16384
    expect(f0r).toBe(-16383); // -0.5 × 0x7fff → -16383 (JS rounds .5 toward +Infinity)

    // Frame 1: L=-0.5, R=0.5
    const f1l = view.getInt16(48, true);
    const f1r = view.getInt16(50, true);
    expect(f1l).toBe(-16383);
    expect(f1r).toBe(16384);
  });

  it("PCM16 clamps out-of-range values", async () => {
    const input = new Float32Array([2.0, -2.0]); // beyond [-1, 1]
    const bytes = await wavBytes([input], 44100);

    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(32767); // clamped to 1.0
    expect(view.getInt16(46, true)).toBe(-32767); // clamped to -1.0
  });
});
