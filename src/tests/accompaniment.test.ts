vi.mock("../lib/dsp/worklet-message", () => ({
  postWorkletMessage: vi.fn().mockResolvedValue(undefined),
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { AccompanimentGraph } from "../offscreen/accompaniment";
import type { AudioGraph } from "../offscreen/audio-graph";
import type { EngineSwitching } from "../offscreen/engine-switching";

beforeEach(() => {
  globalThis.chrome = {
    runtime: { getURL: vi.fn().mockReturnValue("chrome-extension://fake/") },
  } as unknown as typeof chrome;
  globalThis.AudioWorkletNode = class {
    constructor() {}
    connect = vi.fn();
    disconnect = vi.fn();
    port = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  } as unknown as typeof AudioWorkletNode;
});

function fakeGraph(): AudioGraph {
  return {
    requireContext: () => ({
      audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
      createGain: () => ({ connect: vi.fn() }),
      createDynamicsCompressor: () => ({
        connect: vi.fn(),
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      }),
      createDelay: () => ({ connect: vi.fn(), delayTime: { value: 0 } }),
      currentTime: 0,
      destination: { connect: vi.fn() },
    }),
    ensureReady: vi.fn().mockResolvedValue(undefined),
    disconnectNode: vi.fn(),
    rubberbandReadyStatus: true,
    rubberbandNode: { disconnect: vi.fn() },
    passthroughNode: { disconnect: vi.fn() },
    gainANode: { disconnect: vi.fn() },
    gainBNode: { disconnect: vi.fn() },
  } as unknown as AudioGraph;
}

function fakeEngine(overrides: Partial<EngineSwitching> = {}): EngineSwitching {
  const engine = {
    signalsmithAvailable: false,
    signalsmithNode: null,
    initSignalsmith: vi.fn().mockImplementation(async function (this: typeof engine) {
      this.signalsmithNode = {} as EngineSwitching["signalsmithNode"];
      this.signalsmithAvailable = true;
      return true;
    }),
    dryPitch: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as unknown as EngineSwitching;
  return engine;
}

describe("AccompanimentGraph", () => {
  it("returns nodes only when ready", () => {
    const accomp = new AccompanimentGraph(fakeGraph(), fakeEngine());
    expect(accomp.nodes).toBeNull();
  });

  it("init succeeds and marks ready when the engine is available", async () => {
    const accomp = new AccompanimentGraph(fakeGraph(), fakeEngine());
    const ok = await accomp.init(0, false);
    expect(ok).toBe(true);
    expect(accomp.ready).toBe(true);
    expect(accomp.nodes).not.toBeNull();
  });

  it("init returns false and resets when the engine is unavailable", async () => {
    const engine = fakeEngine({ initSignalsmith: vi.fn().mockResolvedValue(false) });
    const accomp = new AccompanimentGraph(fakeGraph(), engine);
    const ok = await accomp.init(0, false);
    expect(ok).toBe(false);
    expect(accomp.ready).toBe(false);
  });

  it("ensureEnabled does not re-init when already ready", async () => {
    const engine = fakeEngine();
    const accomp = new AccompanimentGraph(fakeGraph(), engine);
    await accomp.init(0, false);
    const ok = await accomp.ensureEnabled(0, false);
    expect(ok).toBe(true);
    expect(engine.initSignalsmith).toHaveBeenCalledTimes(1);
  });

  it("resetWorklets disconnects only the worklet nodes and clears ready", () => {
    const accomp = new AccompanimentGraph(fakeGraph(), fakeEngine());
    accomp.resetWorklets();
    expect(accomp.ready).toBe(false);
  });

  it("reset releases every accompaniment node", () => {
    const graph = fakeGraph();
    const disconnectNode = vi.fn();
    (graph as unknown as { disconnectNode: typeof disconnectNode }).disconnectNode = disconnectNode;
    const accomp = new AccompanimentGraph(graph, fakeEngine());
    accomp.reset();
    expect(disconnectNode).toHaveBeenCalled();
    expect(accomp.ready).toBe(false);
  });

  it("deactivate disables and resets", () => {
    const accomp = new AccompanimentGraph(fakeGraph(), fakeEngine());
    (accomp as unknown as { _enabled: boolean })._enabled = true;
    accomp.deactivate();
    expect(accomp.enabled).toBe(false);
    expect(accomp.ready).toBe(false);
  });
});
