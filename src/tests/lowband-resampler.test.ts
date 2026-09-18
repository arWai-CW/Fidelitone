import { describe, it, expect } from "vitest";
import { LowbandResampler } from "../processors/lowband-resampler.js";

const BLOCK_SIZE = 128;
const SAMPLE_RATE = 48000;

function sineBlock(
  len: number,
  freq: number,
  sr: number,
  offset = 0,
): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * (i + offset)) / sr);
  }
  return out;
}

function makeProcessor(
  rate: number,
  sampleRate = SAMPLE_RATE,
): LowbandResampler {
  const processor = new LowbandResampler();
  (
    processor as unknown as {
      _handleMessage(data: Record<string, unknown>): void;
    }
  )._handleMessage({
    type: "INIT",
    channels: 2,
    pitchScale: rate,
    sampleRate,
  });
  return processor;
}

function runBlock(
  processor: LowbandResampler,
  input: Float32Array,
): Float32Array {
  const out = new Float32Array(BLOCK_SIZE);
  processor.process([[input]], [[out]]);
  return out;
}

function runStereoBlock(
  processor: LowbandResampler,
  left: Float32Array,
  right: Float32Array,
): [Float32Array, Float32Array] {
  const leftOut = new Float32Array(BLOCK_SIZE);
  const rightOut = new Float32Array(BLOCK_SIZE);
  processor.process([[left, right]], [[leftOut, rightOut]]);
  return [leftOut, rightOut];
}

function rms(values: Float32Array): number {
  return Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0) /
      values.length,
  );
}

function joinBlocks(blocks: Float32Array[]): Float32Array {
  return new Float32Array(
    blocks.flatMap((block) => Array.from(block)),
  );
}

function collectSineBlocks(
  processor: LowbandResampler,
  rate: number,
  blocks = 120,
): Float32Array[] {
  const outputs: Float32Array[] = [];
  let phase = 0;
  for (let block = 0; block < blocks; block++) {
    outputs.push(
      runBlock(
        processor,
        sineBlock(BLOCK_SIZE, 100, SAMPLE_RATE, phase),
      ),
    );
    phase += BLOCK_SIZE;
  }
  return outputs;
}

/** Estimate the strongest frequency near an expected pitch. */
function peakFrequencyNear(
  samples: Float32Array,
  sr: number,
  expected: number,
): number {
  let bestFrequency = expected;
  let bestMagnitude = -1;

  for (
    let frequency = expected - 8;
    frequency <= expected + 8;
    frequency += 0.25
  ) {
    let real = 0;
    let imaginary = 0;
    for (let i = 0; i < samples.length; i++) {
      const angle = (2 * Math.PI * frequency * i) / sr;
      real += samples[i] * Math.cos(angle);
      imaginary -= samples[i] * Math.sin(angle);
    }
    const magnitude = Math.hypot(real, imaginary);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestFrequency = frequency;
    }
  }

  return bestFrequency;
}

function firstAudibleBlock(outputs: Float32Array[]): number {
  return outputs.findIndex((output) => rms(output) > 0.01);
}

describe("LowbandResampler processor", () => {
  it.each([0.5, 1, 1.5, 2])(
    "rate=%s produces continuous bounded-latency output at the requested pitch",
    (rate) => {
      const processor = makeProcessor(rate);
      const outputs = collectSineBlocks(processor, rate);
      const firstAudible = firstAudibleBlock(outputs);

      expect(firstAudible).toBeGreaterThanOrEqual(0);
      expect(firstAudible).toBeLessThan(6);

      const steadyBlocks = outputs.slice(firstAudible, firstAudible + 96);
      expect(steadyBlocks).toHaveLength(96);
      for (const output of steadyBlocks) {
        expect(output.length).toBe(BLOCK_SIZE);
        expect(rms(output)).toBeGreaterThan(0.05);
        expect(output.every(Number.isFinite)).toBe(true);
      }

      const steadySamples = joinBlocks(steadyBlocks.slice(2));
      const measured = peakFrequencyNear(
        steadySamples,
        SAMPLE_RATE,
        100 * rate,
      );
      expect(Math.abs(measured - 100 * rate)).toBeLessThan(1.5);
    },
  );

  it("keeps stereo channels coherent without collapsing them to one channel", () => {
    const processor = makeProcessor(1);
    const outputs: Array<[Float32Array, Float32Array]> = [];
    for (let block = 0; block < 32; block++) {
      outputs.push(
        runStereoBlock(
          processor,
          sineBlock(BLOCK_SIZE, 80, SAMPLE_RATE, block * BLOCK_SIZE),
          sineBlock(BLOCK_SIZE, 130, SAMPLE_RATE, block * BLOCK_SIZE),
        ),
      );
    }

    const firstAudible = outputs.findIndex(
      ([left, right]) => rms(left) > 0.01 || rms(right) > 0.01,
    );
    const steady = outputs.slice(firstAudible, firstAudible + 48);
    const left = joinBlocks(steady.map(([channel]) => channel));
    const right = joinBlocks(steady.map(([, channel]) => channel));

    expect(firstAudible).toBeLessThan(6);
    expect(rms(left)).toBeGreaterThan(0.1);
    expect(rms(right)).toBeGreaterThan(0.1);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
    expect(
      left.some((value, index) => Math.abs(value - right[index]) > 0.01),
    ).toBe(true);
  });

  it("updates pitch without resetting the live buffer", () => {
    const processor = makeProcessor(1);
    collectSineBlocks(processor, 1, 12);

    (
      processor as unknown as {
        _handleMessage(data: Record<string, unknown>): void;
      }
    )._handleMessage({ type: "SET_PITCH", pitchScale: 1.5 });

    const updated: Float32Array[] = [];
    let phase = 12 * BLOCK_SIZE;
    for (let block = 0; block < 64; block++) {
      updated.push(
        runBlock(
          processor,
          sineBlock(BLOCK_SIZE, 100, SAMPLE_RATE, phase),
        ),
      );
      phase += BLOCK_SIZE;
    }

    expect(rms(updated[0])).toBeGreaterThan(0.01);
    expect(joinBlocks(updated).every(Number.isFinite)).toBe(true);

    const steadySamples = joinBlocks(updated.slice(8));
    const measured = peakFrequencyNear(
      steadySamples,
      SAMPLE_RATE,
      150,
    );
    expect(Math.abs(measured - 150)).toBeLessThan(1.5);
  });

  it("recovers after an input gap without treating two empty blocks as fatal", () => {
    const processor = makeProcessor(1);
    const outputs: Float32Array[] = [];
    let phase = 0;
    for (let block = 0; block < 12; block++) {
      outputs.push(
        runBlock(
          processor,
          sineBlock(BLOCK_SIZE, 100, SAMPLE_RATE, phase),
        ),
      );
      phase += BLOCK_SIZE;
    }
    for (let block = 0; block < 4; block++) {
      outputs.push(runBlock(processor, new Float32Array(BLOCK_SIZE)));
    }
    for (let block = 0; block < 24; block++) {
      outputs.push(
        runBlock(
          processor,
          sineBlock(BLOCK_SIZE, 100, SAMPLE_RATE, phase),
        ),
      );
      phase += BLOCK_SIZE;
    }

    const resumed = outputs.slice(16);
    expect(resumed.slice(0, 4).every((output) => output.every(Number.isFinite))).toBe(true);
    expect(rms(resumed[8])).toBeGreaterThan(0.01);
    expect(joinBlocks(resumed.slice(8)).every(Number.isFinite)).toBe(true);
  });

  it("stays continuous over a long stream at slow and fast rates", () => {
    for (const rate of [0.5, 2] as const) {
      const processor = makeProcessor(rate);
      const outputs = collectSineBlocks(processor, rate, 480);
      const firstAudible = firstAudibleBlock(outputs);
      const steady = outputs.slice(firstAudible + 4);

      expect(firstAudible).toBeLessThan(6);
      expect(
        steady.filter((output) => rms(output) < 0.001),
      ).toHaveLength(0);
      expect(joinBlocks(steady).every(Number.isFinite)).toBe(true);
    }
  });

  it("bounds low-rate latency with forward timeline repair", () => {
    const processor = makeProcessor(0.5);
    collectSineBlocks(processor, 0.5, 480);

    const state = processor as unknown as {
      _readPos: number;
      _channelStates: Array<{ input: { writeIndex: number } }>;
    };
    const writeIndex = state._channelStates[0].input.writeIndex;

    expect(writeIndex - state._readPos).toBeLessThan(4608);
    expect(state._readPos).toBeGreaterThan(0);
  });

  it("clamps invalid rates instead of producing NaNs", () => {
    for (const [input, expected] of [
      [0, 0.5],
      [-1, 0.5],
      [NaN, 0.5],
      [3, 2],
    ] as const) {
      const processor = makeProcessor(input);
      expect(
        (
          processor as unknown as {
            _targetRate: number;
          }
        )._targetRate,
      ).toBe(expected);
    }
  });
});
