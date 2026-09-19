import { describe, it, expect } from "vitest";
import { computeButterworth } from "../lib/dsp/math";

function applyFilterDF2T(
  input: Float32Array,
  b: number[],
  a: number[],
): Float32Array {
  const output = new Float32Array(input.length);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < input.length; i++) {
    const w = input[i] - a[1] * s1 - a[2] * s2;
    output[i] = b[0] * w + b[1] * s1 + b[2] * s2;
    s2 = s1;
    s1 = w;
  }
  return output;
}

function cascadeTwoStages(
  input: Float32Array,
  b: number[],
  a: number[],
): Float32Array {
  return applyFilterDF2T(applyFilterDF2T(input, b, a), b, a);
}

function rms(values: Float32Array): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function steadyStateRmsGain(input: Float32Array, output: Float32Array, discard = 4096): number {
  const inputGain = rms(input.slice(discard));
  return inputGain === 0 ? 0 : rms(output.slice(discard)) / inputGain;
}

describe("Linkwitz-Riley crossover coefficients", () => {
  const sr = 48000;
  const cutoff = 175;

  it("uses matched Butterworth-derived low-pass and high-pass numerators", () => {
    const { lpB, hpB, a } = computeButterworth(cutoff, sr);
    expect(lpB).toHaveLength(3);
    expect(hpB).toHaveLength(3);
    expect(a).toHaveLength(3);
    expect(a[0]).toBe(1);
    expect(lpB[0]).toBeGreaterThan(0);
    expect(hpB[0]).toBeGreaterThan(0);
    expect(lpB[0]).toBeLessThan(hpB[0]);
  });

  it("passes DC through the cascaded low band", () => {
    const { lpB, a } = computeButterworth(cutoff, sr);
    const dc = new Float32Array(8192).fill(0.5);
    const out = cascadeTwoStages(dc, lpB, a);
    expect(steadyStateRmsGain(dc, out)).toBeCloseTo(1, 4);
  });

  it("rejects DC and passes 10kHz through the cascaded high band", () => {
    const { hpB, a } = computeButterworth(cutoff, sr);
    const dc = new Float32Array(8192).fill(0.5);
    const dcOut = cascadeTwoStages(dc, hpB, a);
    expect(steadyStateRmsGain(dc, dcOut)).toBeLessThan(0.001);

    const input = new Float32Array(8192);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 10000 * i) / sr);
    }
    const out = cascadeTwoStages(input, hpB, a);
    expect(steadyStateRmsGain(input, out)).toBeGreaterThan(0.98);
  });

  it("keeps the recombined band magnitude flat at 1kHz", () => {
    const coeffs = computeButterworth(cutoff, sr);
    const input = new Float32Array(12288);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
    }
    const low = cascadeTwoStages(input, coeffs.lpB, coeffs.a);
    const high = cascadeTwoStages(input, coeffs.hpB, coeffs.a);
    const recombined = input.map((value, index) => low[index] + high[index]);
    expect(steadyStateRmsGain(input, recombined)).toBeCloseTo(1, 1);
  });

  it("routes 50Hz to the low band and 1kHz primarily to the high band", () => {
    const coeffs = computeButterworth(cutoff, sr);
    const lowInput = new Float32Array(8192);
    const highInput = new Float32Array(8192);
    for (let i = 0; i < lowInput.length; i++) {
      lowInput[i] = Math.sin((2 * Math.PI * 50 * i) / sr);
      highInput[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
    }

    const lowBand = cascadeTwoStages(lowInput, coeffs.lpB, coeffs.a);
    const highBand = cascadeTwoStages(highInput, coeffs.hpB, coeffs.a);
    expect(steadyStateRmsGain(lowInput, lowBand)).toBeGreaterThan(0.98);
    expect(steadyStateRmsGain(highInput, highBand)).toBeGreaterThan(0.95);
  });
});
