import { describe, expect, it, vi } from "vitest";
import {
  OUTPUT_GATE_MS,
  createOutputGate,
  delayGate,
  scheduleGate,
  type GainParamLike,
} from "../offscreen/output-gate";
import { fakeContext, reaches } from "./helpers/fake-web-audio";

function param(value: number): GainParamLike & {
  cancelScheduledValues: ReturnType<typeof vi.fn>;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
} {
  return {
    value,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

describe("output gate", () => {
  it("ramps from the current value to the target", () => {
    const gain = param(1);
    expect(scheduleGate({ param: gain, currentTime: 10 }, 0, OUTPUT_GATE_MS)).toBe(true);

    expect(gain.cancelScheduledValues).toHaveBeenCalledWith(10);
    expect(gain.setValueAtTime).toHaveBeenCalledWith(1, 10);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10 + OUTPUT_GATE_MS / 1000);
  });

  it("reports nothing to do when there is no graph or no movement", () => {
    expect(scheduleGate(null, 0, OUTPUT_GATE_MS)).toBe(false);

    const idle = param(0);
    expect(scheduleGate({ param: idle, currentTime: 4 }, 0, OUTPUT_GATE_MS)).toBe(false);
    expect(idle.linearRampToValueAtTime).not.toHaveBeenCalled();
  });

  it("reopens the gate from silence", () => {
    const gain = param(0);
    expect(scheduleGate({ param: gain, currentTime: 2 }, 1, 30)).toBe(true);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 2.03);
  });

  it("resolves early when disposed instead of waiting out the ramp", async () => {
    const started = Date.now();
    let dispose!: () => void;
    const promise = delayGate(5000, (d) => {
      dispose = d;
    });
    dispose();
    await promise;
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("resolves on its own after the ramp", async () => {
    await expect(delayGate(10)).resolves.toBeUndefined();
  });
});

// A gate that nothing connects to is silence with no error: the graph reports
// `connected: true`, every route "ends at the output gate", and no sound comes
// out of the extension. (ADR-0004 step 4.)
describe("master gate wiring", () => {
  it("opens at unity gain and reaches ctx.destination", () => {
    const ctx = fakeContext();
    const gate = createOutputGate(ctx as unknown as BaseAudioContext);

    expect(gate.gain.value).toBe(1);
    expect(gate.connect).toHaveBeenCalledWith(ctx.destination);
    expect(reaches(gate, ctx.destination)).toBe(true);
  });
});
