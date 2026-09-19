import { describe, expect, it } from "vitest";
import {
  RubberBandLiveShifter,
  RUBBERBAND_OFFSCREEN_OPTIONS,
  RUBBERBAND_WORKER_OPTIONS,
  type RubberBandWasmExports,
} from "../lib/dsp/rubberband-live-shifter";

function createExports() {
  const buffer = new ArrayBuffer(16384);
  const calls: string[] = [];
  const freed: number[] = [];
  let nextPointer = 1024;
  let state = 0;
  const exports: RubberBandWasmExports = {
    memory: { buffer } as WebAssembly.Memory,
    rb_live_new: (sampleRate, channels, options) => {
      calls.push(`new:${sampleRate}:${channels}:${options}`);
      state = 7;
      return state;
    },
    rb_live_delete: (liveState) => {
      calls.push(`delete:${liveState}`);
      state = 0;
    },
    rb_live_get_block_size: () => 512,
    rb_live_get_start_delay: () => 256,
    rb_live_set_pitch_scale: (liveState, pitchScale) => {
      calls.push(`pitch:${liveState}:${pitchScale}`);
    },
    rb_live_set_formant_option: (liveState, option) => {
      calls.push(`formant:${liveState}:${option}`);
    },
    rb_live_shift: (liveState, inputPointers, outputPointers) => {
      const views = new Uint32Array(buffer);
      const input = new Float32Array(
        buffer,
        views[inputPointers >> 2],
        512,
      );
      const output = new Float32Array(
        buffer,
        views[outputPointers >> 2],
        512,
      );
      for (let sample = 0; sample < 512; sample++) {
        output[sample] = input[sample] * 2;
      }
      calls.push(`shift:${liveState}`);
    },
    wasm_malloc: (size) => {
      const pointer = nextPointer;
      nextPointer += size;
      return pointer;
    },
    wasm_free: (pointer) => freed.push(pointer),
  };
  return { exports, calls, freed };
}

describe("RubberBandLiveShifter", () => {
  it("keeps the two caller option contracts distinct", () => {
    expect(RUBBERBAND_OFFSCREEN_OPTIONS).toBe(0x121);
    expect(RUBBERBAND_WORKER_OPTIONS).toBe(0);
  });

  it("initializes with the offscreen options and shifts one block", () => {
    const { exports, calls } = createExports();
    const shifter = new RubberBandLiveShifter(exports, RUBBERBAND_OFFSCREEN_OPTIONS);
    const input = new Float32Array(512).fill(0.25);

    const initialized = shifter.init(48000, 2, 1.5, true);
    expect(initialized).toEqual({
      blockSize: 512,
      startDelay: 256,
      channels: 2,
      sampleRate: 48000,
    });
    expect(calls).toContain(`new:48000:2:${RUBBERBAND_OFFSCREEN_OPTIONS}`);
    expect(calls).toContain("pitch:7:1.5");
    expect(calls).toContain("formant:7:16777216");

    const output = [new Float32Array(512), new Float32Array(512)];
    const shifted = shifter.shift([input, input], output);
    expect(shifted).toBe(output);
    expect(shifted[0][0]).toBe(0.5);
    expect(shifted[0]).toHaveLength(512);
    expect(calls).toContain("shift:7");
  });

  it("releases the LiveShifter state and every allocation", () => {
    const { exports, freed } = createExports();
    const shifter = new RubberBandLiveShifter(exports, RUBBERBAND_OFFSCREEN_OPTIONS);
    shifter.init(48000, 2, 1.0);
    const allocated = freed.length;

    shifter.delete();

    expect(freed).toHaveLength(allocated + 6);
    expect(shifter.shift([new Float32Array(512)])).toEqual([]);
  });

  it("replaces an existing LiveShifter before reinitializing", () => {
    const { exports, calls } = createExports();
    const shifter = new RubberBandLiveShifter(exports, RUBBERBAND_OFFSCREEN_OPTIONS);
    shifter.init(48000, 2, 1.0);

    shifter.init(44100, 1, 0.5);

    expect(calls.filter((call) => call.startsWith("new:"))).toEqual([
      "new:48000:2:289",
      "new:44100:1:289",
    ]);
  });
});
