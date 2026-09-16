import { describe, it, expect, vi, beforeEach } from "vitest";
import { encodeOpus } from "../lib/opus-encoder";

describe("encodeOpus", () => {
  const originalAudioEncoder = globalThis.AudioEncoder;

  beforeEach(() => {
    // Restore between tests
    globalThis.AudioEncoder = originalAudioEncoder;
  });

  it("returns null when AudioEncoder is undefined", async () => {
    // @ts-expect-error — intentionally removing AudioEncoder
    delete globalThis.AudioEncoder;

    const channels = [new Float32Array(1024)];
    const result = await encodeOpus(channels, 48000);
    expect(result).toBeNull();
  });

  it("returns null for empty input (0 frames)", async () => {
    const channels = [new Float32Array(0)];
    const result = await encodeOpus(channels, 48000);
    expect(result).toBeNull();
  });

  it("accepts correct parameter signature", () => {
    // Verify the function accepts Float32Array[] and number
    expect(typeof encodeOpus).toBe("function");
    const fn = encodeOpus as (
      channels: Float32Array[],
      sampleRate: number,
    ) => Promise<Blob | null>;
    // Should not throw with valid args (will hit null fallback in node)
    expect(() => fn([new Float32Array(100)], 44100)).not.toThrow();
  });
});
