import { describe, expect, it, vi } from "vitest";
import { EngineSwitching } from "../offscreen/engine-switching";
import type { AudioGraph } from "../offscreen/audio-graph";

function fakeGraph(overrides: Partial<AudioGraph> = {}): AudioGraph {
  return {
    rubberbandReadyStatus: true,
    rubberbandNode: { disconnect: vi.fn() },
    gainANode: {
      gain: { cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    },
    gainBNode: {
      gain: { cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    },
    requireContext: () => ({ currentTime: 0 }) as unknown as AudioContext,
    ensureReady: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AudioGraph;
}

describe("EngineSwitching", () => {
  it("same engine with a connected source re-routes and does not crossfade", async () => {
    const graph = fakeGraph();
    const engine = new EngineSwitching(graph);
    const connectSource = vi.fn().mockReturnValue(true);
    const applyPitch = vi.fn();

    const result = await engine.setEngine("rubberband", { connected: true, bypass: false, accompanimentMode: false }, connectSource, applyPitch);

    expect(result).toBe(true);
    expect(connectSource).toHaveBeenCalledWith(true);
    expect(engine.selectedEngine).toBe("rubberband");
  });

  it("same engine without a connected source only sets gains", async () => {
    const graph = fakeGraph();
    const engine = new EngineSwitching(graph);
    const result = await engine.setEngine("rubberband", { connected: false, bypass: false, accompanimentMode: false }, vi.fn(), vi.fn());
    expect(result).toBe(true);
  });

  it("different engine crossfades and applies pitch", async () => {
    const graph = fakeGraph();
    const engine = new EngineSwitching(graph, vi.fn().mockResolvedValue({ node: {} }));
    const connectSource = vi.fn().mockReturnValue(true);
    const applyPitch = vi.fn();

    const result = await engine.setEngine("signalsmith", { connected: true, bypass: false, accompanimentMode: false }, connectSource, applyPitch);

    expect(result).toBe(true);
    expect(connectSource).toHaveBeenCalledWith(true);
    expect(engine.selectedEngine).toBe("signalsmith");
  });

  it("rolls back the engine and re-connects when connect fails", async () => {
    const graph = fakeGraph();
    const engine = new EngineSwitching(graph, vi.fn().mockResolvedValue({ node: {} }));
    const connectSource = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const applyPitch = vi.fn();

    const result = await engine.setEngine("signalsmith", { connected: true, bypass: false, accompanimentMode: false }, connectSource, applyPitch);

    expect(result).toBe(false);
    expect(engine.selectedEngine).toBe("rubberband");
  });

  it("returns false when the requested engine is unavailable", async () => {
    const graph = fakeGraph({ rubberbandReadyStatus: false, rubberbandNode: null });
    const engine = new EngineSwitching(graph);
    const result = await engine.setEngine("rubberband", { connected: false, bypass: false, accompanimentMode: false }, vi.fn(), vi.fn());
    expect(result).toBe(false);
  });
});
