vi.mock("../lib/dsp/signalsmith-fallback", () => ({
  createSignalsmithEngine: vi.fn(),
  setSignalsmithPitch: vi.fn().mockResolvedValue(undefined),
  setSignalsmithPitchWithFormants: vi.fn().mockResolvedValue(undefined),
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { PitchEngine } from "../offscreen/pitch-engine";
import {
  createSignalsmithEngine,
  setSignalsmithPitch,
  setSignalsmithPitchWithFormants,
} from "../lib/dsp/signalsmith-fallback";
import type { AudioGraph } from "../offscreen/audio-graph";

const mockCreate = vi.mocked(createSignalsmithEngine);
const mockPitch = vi.mocked(setSignalsmithPitchWithFormants);
const mockDryPitch = vi.mocked(setSignalsmithPitch);

function fakeGraph() {
  return {
    ensureReady: vi.fn().mockResolvedValue(undefined),
    requireContext: () => ({ currentTime: 1, sampleRate: 48000 }),
    disconnectNode: vi.fn(),
  } as unknown as AudioGraph;
}

function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioWorkletNode;
}

/** A createSignalsmithEngine that only resolves when the test says so. */
function deferredCreate() {
  let release!: (node: { node: AudioWorkletNode }) => void;
  const gate = new Promise<{ node: AudioWorkletNode }>((resolve) => {
    release = resolve;
  });
  const node = fakeNode();
  mockCreate.mockReturnValue(gate as unknown as ReturnType<typeof createSignalsmithEngine>);
  return { node, release: () => release({ node }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPitch.mockResolvedValue(undefined);
  mockDryPitch.mockResolvedValue(undefined);
});

describe("PitchEngine", () => {
  it("starts not ready and reports no node", () => {
    const engine = new PitchEngine(fakeGraph(), mockCreate);
    expect(engine.ready).toBe(false);
    expect(engine.signalsmithNode).toBeNull();
  });

  it("creates one node and applies the pitch it was initialised with", async () => {
    const node = fakeNode();
    mockCreate.mockResolvedValue({ node, ready: true } as never);
    const engine = new PitchEngine(fakeGraph(), mockCreate);

    await expect(engine.ensureReady(3, true)).resolves.toBe(true);
    expect(engine.ready).toBe(true);
    expect(engine.signalsmithNode).toBe(node);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockPitch).toHaveBeenCalledWith(expect.anything(), 3, true, expect.anything());
  });

  it("is idempotent once the node exists", async () => {
    mockCreate.mockResolvedValue({ node: fakeNode(), ready: true } as never);
    const engine = new PitchEngine(fakeGraph(), mockCreate);

    await engine.ensureReady(0, false);
    await engine.ensureReady(5, false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // Several transitions can ask for the engine at once (a pitch change, a
  // handover pre-warm, accompaniment init). They must share one construction.
  it("shares a single in-flight init between concurrent callers", async () => {
    const { node, release } = deferredCreate();
    const engine = new PitchEngine(fakeGraph(), mockCreate);

    const a = engine.ensureReady(1, false);
    const b = engine.ensureReady(2, false);
    const c = engine.ensureReady(3, false);
    release();

    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    await expect(c).resolves.toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(engine.signalsmithNode).toBe(node);
  });

  it("reports failure and stays unready when construction returns nothing", async () => {
    mockCreate.mockResolvedValue(null as never);
    const engine = new PitchEngine(fakeGraph(), mockCreate);

    await expect(engine.ensureReady(0, false)).resolves.toBe(false);
    expect(engine.ready).toBe(false);
    expect(engine.signalsmithNode).toBeNull();
  });

  it("reports failure and stays unready when construction throws", async () => {
    mockCreate.mockRejectedValue(new Error("no worklet"));
    const engine = new PitchEngine(fakeGraph(), mockCreate);

    await expect(engine.ensureReady(0, false)).resolves.toBe(false);
    expect(engine.ready).toBe(false);
  });

  it("recovers after a failure: the next ensureReady tries again", async () => {
    mockCreate.mockRejectedValueOnce(new Error("no worklet"));
    const engine = new PitchEngine(fakeGraph(), mockCreate);
    await expect(engine.ensureReady(0, false)).resolves.toBe(false);

    mockCreate.mockResolvedValue({ node: fakeNode(), ready: true } as never);
    await expect(engine.ensureReady(0, false)).resolves.toBe(true);
    expect(engine.ready).toBe(true);
  });

  it("no-ops every parameter update while the engine is down", async () => {
    const engine = new PitchEngine(fakeGraph(), mockCreate);
    await engine.applyPitch(3, true);
    await engine.setFormants(true, 3);
    engine.dryPitch(3);
    expect(mockPitch).not.toHaveBeenCalled();
    expect(mockDryPitch).not.toHaveBeenCalled();
  });

  it("routes accompaniment's dry pitch without touching the formant option", async () => {
    const node = fakeNode();
    mockCreate.mockResolvedValue({ node, ready: true } as never);
    const engine = new PitchEngine(fakeGraph(), mockCreate);
    await engine.ensureReady(0, true);
    mockPitch.mockClear();

    engine.dryPitch(4);
    expect(mockDryPitch).toHaveBeenCalledWith(expect.anything(), 4, expect.anything());
    expect(mockPitch).not.toHaveBeenCalled();
  });

  it("reset disconnects the node and allows a fresh init", async () => {
    const graph = fakeGraph();
    const first = fakeNode();
    mockCreate.mockResolvedValue({ node: first, ready: true } as never);
    const engine = new PitchEngine(graph, mockCreate);
    await engine.ensureReady(0, false);

    engine.reset();
    expect(graph.disconnectNode).toHaveBeenCalledWith(first);
    expect(engine.ready).toBe(false);

    mockCreate.mockResolvedValue({ node: fakeNode(), ready: true } as never);
    await expect(engine.ensureReady(0, false)).resolves.toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
