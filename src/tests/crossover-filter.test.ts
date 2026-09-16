import { describe, it, expect } from "vitest";

function computeButterworthLP(cutoffFreq: number, sr: number) {
  const wc = Math.tan((Math.PI * cutoffFreq) / sr);
  const sqrt2 = Math.SQRT2;
  const k = 1 / (1 + sqrt2 * wc + wc * wc);
  return {
    b: [k, 2 * k, k],
    a: [1, 2 * (wc * wc - 1) * k, (1 - sqrt2 * wc + wc * wc) * k],
  };
}

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
  const stage1 = applyFilterDF2T(input, b, a);
  return applyFilterDF2T(stage1, b, a);
}

describe("crossover filter", () => {
  const sr = 48000;
  const cutoff = 150;

  it("Butterworth LP coefficients are valid", () => {
    const { b, a } = computeButterworthLP(cutoff, sr);
    expect(b.length).toBe(3);
    expect(a.length).toBe(3);
    expect(a[0]).toBe(1);
    expect(b[0]).toBeGreaterThan(0);
  });

  it("cascaded LP passes DC (0Hz) with constant gain", () => {
    const { b, a } = computeButterworthLP(cutoff, sr);
    const dc = new Float32Array(2048).fill(0.5);
    const out = cascadeTwoStages(dc, b, a);
    const settled = out[2047];
    expect(settled).not.toBeNaN();
    expect(settled).toBeGreaterThan(0);
    for (let i = 1800; i < 2048; i++) {
      expect(out[i]).toBeCloseTo(settled, 4);
    }
  });

  it("cascaded LP attenuates 10kHz relative to DC gain", () => {
    const { b, a } = computeButterworthLP(cutoff, sr);
    const dc = new Float32Array(4096).fill(0.5);
    const outDC = cascadeTwoStages(dc, b, a);
    const dcGain = outDC[4095] / 0.5;

    const freq = 10000;
    const signal = new Float32Array(8192);
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin((2 * Math.PI * freq * i) / sr);
    }
    const out = cascadeTwoStages(signal, b, a);
    const outputRMS = Math.sqrt(
      out.slice(4096).reduce((s, v) => s + v * v, 0) / 4096,
    );
    expect(outputRMS).toBeLessThan(0.5 * dcGain * 0.01);
  });

  it("LP + HP sums to flat magnitude at 1kHz", () => {
    const { b, a } = computeButterworthLP(cutoff, sr);
    const freq = 1000;
    const signal = new Float32Array(8192);
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin((2 * Math.PI * freq * i) / sr);
    }
    const lp = cascadeTwoStages(signal, b, a);
    const hp = signal.map((v, i) => v - lp[i]);
    const sum = lp.map((v, i) => v + hp[i]);
    const inputRMS = Math.sqrt(
      signal.slice(4096).reduce((s, v) => s + v * v, 0) / 4096,
    );
    const sumRMS = Math.sqrt(
      sum.slice(4096).reduce((s, v) => s + v * v, 0) / 4096,
    );
    expect(sumRMS).toBeCloseTo(inputRMS, 1);
  });

  it("crossover: 100Hz passes LP, 1kHz mostly in HP", () => {
    const { b, a } = computeButterworthLP(cutoff, sr);
    const makeSignal = (freq: number) => {
      const s = new Float32Array(8192);
      for (let i = 0; i < s.length; i++)
        s[i] = Math.sin((2 * Math.PI * freq * i) / sr);
      return s;
    };

    const lowSig = makeSignal(100);
    const lpLow = cascadeTwoStages(lowSig, b, a);
    const lpLowRMS = Math.sqrt(
      lpLow.slice(4096).reduce((s, v) => s + v * v, 0) / 4096,
    );
    const lowInputRMS = Math.sqrt(
      lowSig.slice(4096).reduce((s, v) => s + v * v, 0) / 4096,
    );
    expect(lpLowRMS).toBeGreaterThan(lowInputRMS * 0.8);

    const highSig = makeSignal(1000);
    const lpHigh = cascadeTwoStages(highSig, b, a);
    const hpHigh = highSig.map((v, i) => v - lpHigh[i]);
    const hpHighRMS = Math.sqrt(
      hpHigh.slice(4096).reduce((s, v) => s + v * v, 0) / 4096,
    );
    const highInputRMS = Math.sqrt(
      highSig.slice(4096).reduce((s, v) => s + v * v, 0) / 4096,
    );
    expect(hpHighRMS).toBeGreaterThan(highInputRMS * 0.8);
  });
});
