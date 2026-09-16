import { describe, it, expect } from "vitest";

function cubicInterpolate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function resample(
  input: Float32Array,
  pitchScale: number,
): Float32Array {
  const outputLen = Math.round(input.length * pitchScale);
  const padded = new Float32Array(input.length + 4);
  padded[0] = 0;
  padded[1] = 0;
  for (let i = 0; i < input.length; i++) padded[i + 2] = input[i];
  padded[input.length + 2] = input[input.length - 1];
  padded[input.length + 3] = input[input.length - 1];

  const output = new Float32Array(outputLen);
  for (let outIdx = 0; outIdx < outputLen; outIdx++) {
    const inputPos = outIdx / pitchScale;
    const integerPos = Math.floor(inputPos);
    const fraction = inputPos - integerPos;
    const idx = integerPos + 2;
    output[outIdx] = cubicInterpolate(
      padded[idx - 1],
      padded[idx],
      padded[idx + 1],
      padded[idx + 2],
      fraction,
    );
  }
  return output;
}

describe("lowband resampler", () => {
  it("pitchScale=1.0 produces same-length output", () => {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const output = resample(input, 1.0);
    expect(output.length).toBe(4);
  });

  it("pitchScale=2.0 doubles output length", () => {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const output = resample(input, 2.0);
    expect(output.length).toBe(8);
  });

  it("pitchScale=0.5 halves output length", () => {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const output = resample(input, 0.5);
    expect(output.length).toBe(3);
  });

  it("resampling preserves DC offset", () => {
    const input = new Float32Array(64).fill(0.5);
    const output = resample(input, 1.5);
    for (let i = 10; i < output.length - 10; i++) {
      expect(output[i]).toBeCloseTo(0.5, 2);
    }
  });

  it("cubic interpolation is smooth (no discontinuities)", () => {
    const input = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      input[i] = Math.sin((2 * Math.PI * 10 * i) / 48000);
    }
    const output = resample(input, 1.3348);
    for (let i = 1; i < output.length; i++) {
      const diff = Math.abs(output[i] - output[i - 1]);
      expect(diff).toBeLessThan(0.1);
    }
  });
});
