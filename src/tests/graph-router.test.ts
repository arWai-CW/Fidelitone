import { describe, expect, it, vi } from "vitest";
import { GraphRouter } from "../offscreen/graph-router";
import { createOutputGate } from "../offscreen/output-gate";
import type { AudioGraph } from "../offscreen/audio-graph";
import type { EngineSwitching } from "../offscreen/engine-switching";
import type { AccompanimentGraph } from "../offscreen/accompaniment";
import { fakeContext, fakeNode as wiredNode, reaches } from "./helpers/fake-web-audio";

function fakeNode(): AudioWorkletNode {
  return { connect: vi.fn(), disconnect: vi.fn(), port: { postMessage: vi.fn() } } as unknown as AudioWorkletNode;
}

function fakeSource(): MediaStreamAudioSourceNode {
  return { connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
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
    requireOutput: () => fakeNode(),
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

  const getSource = () => overrides.source ?? fakeSource();
  return new GraphRouter(graph, engine, accompaniment, getSource);
}

describe("GraphRouter", () => {
  it("routes bypass through passthrough", () => {
    const source = fakeSource();
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
      requireOutput: () => fakeNode(),
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

  it("ends every route at the output gate instead of ctx.destination", () => {
    const gate = fakeNode();
    const destination = fakeNode();
    const graph = {
      ready: true,
      rubberbandReadyStatus: true,
      rubberbandNode: fakeNode(),
      passthroughNode: fakeNode(),
      gainANode: fakeNode(),
      gainBNode: fakeNode(),
      requireContext: () => ({ destination, currentTime: 0 }),
      requireOutput: () => gate,
      requirePassthrough: () => fakeNode(),
      disconnectNode: vi.fn(),
    } as unknown as AudioGraph;

    const engine = {
      signalsmithAvailable: false,
      signalsmithNode: null,
      effectiveEngine: vi.fn().mockReturnValue("rubberband"),
      setGains: vi.fn(),
    } as unknown as EngineSwitching;

    const source = fakeSource();
    const router = new GraphRouter(graph, engine, { ready: false, enabled: false, nodes: null } as unknown as AccompanimentGraph, () => source);

    expect(router.connectSource({ bypass: true, accompanimentMode: false })).toBe(true);
    expect(router.connectSource({ bypass: false, accompanimentMode: false })).toBe(true);

    const wired = [
      source,
      graph.passthroughNode,
      graph.rubberbandNode,
      graph.gainBNode,
    ] as unknown as Array<{ connect: ReturnType<typeof vi.fn> }>;
    const connectsToGate = wired.some((node) =>
      node.connect.mock.calls.some((args) => args[0] === gate),
    );

    expect(connectsToGate).toBe(true);
    expect(destination.connect).not.toHaveBeenCalled();
  });

  // The router stops at the gate, so the gate must carry the signal the rest of
  // the way. If it does not, every route "succeeds" and the extension is silent.
  it("reaches ctx.destination through the master gate in every route", () => {
    const ctx = fakeContext();
    const gate = createOutputGate(ctx as unknown as BaseAudioContext);
    const destination = ctx.destination;

    const passthrough = wiredNode();
    const rbNode = wiredNode();
    const gainA = wiredNode();
    const gainB = wiredNode();
    const signalNode = wiredNode();

    const graph = {
      ready: true,
      rubberbandReadyStatus: true,
      rubberbandNode: rbNode,
      passthroughNode: passthrough,
      gainANode: gainA,
      gainBNode: gainB,
      requireContext: () => ({ destination, currentTime: 0 }),
      requireOutput: () => gate,
      requirePassthrough: () => passthrough,
      disconnectNode: (node: { disconnect?: () => void } | null) => node?.disconnect?.(),
    } as unknown as AudioGraph;

    const engine = {
      signalsmithAvailable: true,
      signalsmithNode: signalNode,
      effectiveEngine: vi.fn().mockReturnValue("signalsmith"),
      setGains: vi.fn(),
    } as unknown as EngineSwitching;

    const accompNodes = {
      crossover: wiredNode(),
      lowband: wiredNode(),
      signalsmith: wiredNode(),
      limiter: wiredNode(),
      delay: wiredNode(),
      mixBus: wiredNode(),
    };
    const accompaniment = {
      ready: true,
      enabled: true,
      nodes: accompNodes,
    } as unknown as AccompanimentGraph;

    const source = wiredNode();
    const router = new GraphRouter(graph, engine, accompaniment, () => source as unknown as MediaStreamAudioSourceNode);

    expect(router.connectSource({ bypass: true, accompanimentMode: false })).toBe(true);
    expect(reaches(source, destination)).toBe(true);

    expect(router.connectSource({ bypass: false, accompanimentMode: false })).toBe(true);
    expect(reaches(source, destination)).toBe(true);

    expect(router.connectSource({ bypass: false, accompanimentMode: true })).toBe(true);
    expect(reaches(source, destination)).toBe(true);
  });
});
