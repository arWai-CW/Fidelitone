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

function detectTruePeak(samples: Float32Array, index: number): number {
  const len = samples.length;
  const p0 = samples[Math.max(0, index - 1)];
  const p1 = samples[index];
  const p2 = samples[Math.min(len - 1, index + 1)];
  const p3 = samples[Math.min(len - 1, index + 2)];
  let maxAbs = Math.abs(p1);
  for (let i = 1; i <= 3; i++) {
    const val = cubicInterpolate(p0, p1, p2, p3, i / 4);
    const abs = val < 0 ? -val : val;
    if (abs > maxAbs) maxAbs = abs;
  }
  return maxAbs;
}

function limit(
  input: Float32Array,
  thresholdDBTP: number = -1.0,
): Float32Array {
  const threshold = 10 ** (thresholdDBTP / 20);
  const output = new Float32Array(input.length);
  let envelope = 0;
  let prevGain = 1;
  const releaseCoeff = 1 - Math.exp(-1 / (0.05 * 48000));
  const gainSmooth = 0.99;

  for (let i = 0; i < input.length; i++) {
    const tp = detectTruePeak(input, i);
    if (tp > envelope) {
      envelope = tp;
    } else {
      envelope = envelope * (1 - releaseCoeff);
    }
    let gain: number;
    if (envelope > threshold) {
      gain = threshold / envelope;
    } else {
      gain = 1;
    }
    prevGain = prevGain + gainSmooth * (gain - prevGain);
    output[i] = input[i] * prevGain;
  }
  return output;
}

describe("true peak limiter", () => {
  it("detectTruePeak finds inter-sample peaks", () => {
    const samples = new Float32Array([0, 0.8, 0]);
    const tp = detectTruePeak(samples, 1);
    expect(tp).toBeGreaterThan(0.8);
  });

  it("detectTruePeak returns abs(sample) for flat regions", () => {
    const samples = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const tp = detectTruePeak(samples, 1);
    expect(tp).toBeCloseTo(0.5, 4);
  });

  it("limiter reduces gain when signal exceeds threshold", () => {
    const thresholdDBTP = -1.0;
    const threshold = 10 ** (thresholdDBTP / 20);
    const input = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      input[i] = 0.9 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    const output = limit(input, thresholdDBTP);
    let maxTP = 0;
    for (let i = 0; i < output.length; i++) {
      const tp = detectTruePeak(output, i);
      if (tp > maxTP) maxTP = tp;
    }
    expect(maxTP).toBeLessThanOrEqual(threshold + 0.01);
  });

  it("limiter does not reduce gain significantly below threshold", () => {
    const input = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      input[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    const output = limit(input, -1.0);
    const inputRMS = Math.sqrt(
      input.slice(100).reduce((s, v) => s + v * v, 0) / 156,
    );
    const outputRMS = Math.sqrt(
      output.slice(100).reduce((s, v) => s + v * v, 0) / 156,
    );
    expect(outputRMS).toBeGreaterThan(inputRMS * 0.8);
  });

  it("output never exceeds threshold in steady state", () => {
    const threshold = 10 ** (-1.0 / 20);
    const input = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      input[i] = 0.95 * Math.sin((2 * Math.PI * 100 * i) / 48000);
    }
    const output = limit(input, -1.0);
    for (let i = 200; i < 1024; i++) {
      const tp = detectTruePeak(output, i);
      expect(tp).toBeLessThanOrEqual(threshold + 0.001);
    }
  });
});
