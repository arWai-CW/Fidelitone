import { describe, expect, it, vi } from "vitest";
import { GraphRouter } from "../offscreen/graph-router";
import type { AudioGraph } from "../offscreen/audio-graph";
import type { EngineSwitching } from "../offscreen/engine-switching";
import type { AccompanimentGraph } from "../offscreen/accompaniment";

function fakeNode(): AudioWorkletNode {
  return { connect: vi.fn(), disconnect: vi.fn(), port: { postMessage: vi.fn() } } as unknown as AudioWorkletNode;
}

function fakeAccompanimentNodes() {
  return {
    crossover: fakeNode(),
    lowband: fakeNode(),
    signalsmith: fakeNode(),
    limiter: { connect: vi.fn(), disconnect: vi.fn() } as unknown as DynamicsCompressorNode,
    delay: { connect: vi.fn(), disconnect: vi.fn() } as unknown as DelayNode,
    mixBus: { connect: vi.fn(), disconnect: vi.fn() } as unknown as GainNode,
  };
}

function makeRouter(overrides: {
  source?: MediaStreamAudioSourceNode | null;
  ready?: boolean;
  rbReady?: boolean;
  rbNode?: AudioWorkletNode | null;
  signalAvailable?: boolean;
  signalNode?: AudioWorkletNode | null;
  accompReady?: boolean;
  accompNodes?: ReturnType<typeof fakeAccompanimentNodes> | null;
  accompanimentMode?: boolean;
}) {
  const graph = {
    ready: overrides.ready ?? true,
    rubberbandReadyStatus: overrides.rbReady ?? true,
    rubberbandNode: overrides.rbNode ?? fakeNode(),
    passthroughNode: fakeNode(),
    gainANode: fakeNode(),
    gainBNode: fakeNode(),
    requireContext: () => ({ destination: fakeNode(), currentTime: 0 }),
    requirePassthrough: () => fakeNode(),
    disconnectNode: vi.fn(),
  } as unknown as AudioGraph;

  const engine = {
    signalsmithAvailable: overrides.signalAvailable ?? false,
    signalsmithNode: overrides.signalNode ?? null,
    effectiveEngine: vi.fn().mockReturnValue("rubberband"),
    setGains: vi.fn(),
  } as unknown as EngineSwitching;

  const accompaniment = {
    ready: overrides.accompReady ?? false,
    enabled: overrides.accompanimentMode ?? false,
    nodes: overrides.accompNodes ?? null,
  } as unknown as AccompanimentGraph;

  const getSource = () => overrides.source ?? fakeNode();
  return new GraphRouter(graph, engine, accompaniment, getSource);
}

describe("GraphRouter", () => {
  it("routes bypass through passthrough", () => {
    const source = fakeNode();
    const router = makeRouter({ source });
    const result = router.connectSource({ bypass: true, accompanimentMode: false });
    expect(result).toBe(true);
  });

  it("rewire disconnects every node and resets gains", () => {
    const disconnectNode = vi.fn();
    const graph = {
      ready: true,
      rubberbandReadyStatus: true,
      rubberbandNode: fakeNode(),
      passthroughNode: fakeNode(),
      gainANode: fakeNode(),
      gainBNode: fakeNode(),
      requireContext: () => ({ destination: fakeNode(), currentTime: 0 }),
      requirePassthrough: () => fakeNode(),
      disconnectNode,
    } as unknown as AudioGraph;

    const engine = {
      signalsmithAvailable: false,
      signalsmithNode: null,
      effectiveEngine: vi.fn().mockReturnValue("rubberband"),
      setGains: vi.fn(),
    } as unknown as EngineSwitching;

    const accompaniment = {
      ready: false,
      enabled: false,
      nodes: null,
    } as unknown as AccompanimentGraph;

    const router = new GraphRouter(graph, engine, accompaniment, () => null);
    router.rewire(true);
    expect(disconnectNode).toHaveBeenCalled();
  });
});
