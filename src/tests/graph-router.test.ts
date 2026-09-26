import { describe, expect, it, vi } from "vitest";
import { GraphRouter } from "../offscreen/graph-router";
import { createOutputGate } from "../offscreen/output-gate";
import type { AudioGraph } from "../offscreen/audio-graph";
import type { PitchEngine } from "../offscreen/pitch-engine";
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
  engineReady?: boolean;
  engineNode?: AudioWorkletNode | null;
  accompReady?: boolean;
  accompNodes?: ReturnType<typeof fakeAccompanimentNodes> | null;
  accompanimentMode?: boolean;
}) {
  const passthrough = fakeNode();
  const gate = fakeNode();
  const graph = {
    ready: overrides.ready ?? true,
    passthroughNode: passthrough,
    requireContext: () => ({ destination: fakeNode(), currentTime: 0 }),
    requireOutput: () => gate,
    requirePassthrough: () => passthrough,
    disconnectNode: vi.fn(),
  } as unknown as AudioGraph;

  const engine = {
    ready: overrides.engineReady ?? false,
    signalsmithNode: overrides.engineNode ?? null,
  } as unknown as PitchEngine;

  const accompaniment = {
    ready: overrides.accompReady ?? false,
    enabled: overrides.accompanimentMode ?? false,
    nodes: overrides.accompNodes ?? null,
  } as unknown as AccompanimentGraph;

  const getSource = () =>
    "source" in overrides ? overrides.source! : fakeSource();
  return { router: new GraphRouter(graph, engine, accompaniment, getSource), graph, gate, passthrough };
}

describe("GraphRouter", () => {
  it("routes bypass through passthrough", () => {
    const source = fakeSource();
    const { router } = makeRouter({ source });
    expect(router.connectSource({ bypass: true, accompanimentMode: false })).toBe(true);
  });

  it("routes through the engine when it is ready", () => {
    const source = fakeSource();
    const engineNode = fakeNode();
    const { router } = makeRouter({ source, engineReady: true, engineNode });
    expect(router.connectSource({ bypass: false, accompanimentMode: false })).toBe(true);
    expect(source.connect).toHaveBeenCalledWith(engineNode);
  });

  // ADR-0007: a failed engine must not leave a slider that looks live over audio
  // that is not being processed. The route falls back and the popup is told.
  it("falls back to passthrough when the engine is not up", () => {
    const source = fakeSource();
    const { router, passthrough } = makeRouter({ source, engineReady: false });
    expect(router.connectSource({ bypass: false, accompanimentMode: false })).toBe(true);
    expect(source.connect).toHaveBeenCalledWith(passthrough);
  });

  it("does not connect the engine when accompaniment mode is on", () => {
    const source = fakeSource();
    const engineNode = fakeNode();
    const { router, passthrough } = makeRouter({
      source,
      engineReady: true,
      engineNode,
      accompReady: true,
      accompNodes: fakeAccompanimentNodes(),
    });
    expect(router.connectSource({ bypass: false, accompanimentMode: true })).toBe(true);
    expect(source.connect).not.toHaveBeenCalledWith(engineNode);
    expect(source.connect).not.toHaveBeenCalledWith(passthrough);
  });

  it("skips connecting when there is no source or the graph is not ready", () => {
    const { router } = makeRouter({ source: null });
    expect(router.connectSource({ bypass: false, accompanimentMode: false })).toBe(false);
  });

  it("rewire disconnects every node", () => {
    const disconnectNode = vi.fn();
    const graph = {
      ready: true,
      passthroughNode: fakeNode(),
      requireContext: () => ({ destination: fakeNode(), currentTime: 0 }),
      requireOutput: () => fakeNode(),
      requirePassthrough: () => fakeNode(),
      disconnectNode,
    } as unknown as AudioGraph;

    const engine = { ready: false, signalsmithNode: null } as unknown as PitchEngine;
    const accompaniment = { ready: false, enabled: false, nodes: null } as unknown as AccompanimentGraph;

    new GraphRouter(graph, engine, accompaniment, () => null).rewire();
    expect(disconnectNode).toHaveBeenCalled();
  });

  it("ends every route at the output gate instead of ctx.destination", () => {
    const destination = fakeNode();
    const gate = fakeNode();
    const passthrough = fakeNode();
    const graph = {
      ready: true,
      passthroughNode: passthrough,
      requireContext: () => ({ destination, currentTime: 0 }),
      requireOutput: () => gate,
      requirePassthrough: () => passthrough,
      disconnectNode: vi.fn(),
    } as unknown as AudioGraph;

    const engine = { ready: true, signalsmithNode: fakeNode() } as unknown as PitchEngine;
    const source = fakeSource();
    const router = new GraphRouter(
      graph,
      engine,
      { ready: false, enabled: false, nodes: null } as unknown as AccompanimentGraph,
      () => source,
    );

    expect(router.connectSource({ bypass: true, accompanimentMode: false })).toBe(true);
    expect(router.connectSource({ bypass: false, accompanimentMode: false })).toBe(true);

    const wired = [source, passthrough, engine.signalsmithNode] as unknown as Array<{
      connect: ReturnType<typeof vi.fn>;
    }>;
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
    const signalNode = wiredNode();

    const graph = {
      ready: true,
      passthroughNode: passthrough,
      requireContext: () => ({ destination, currentTime: 0 }),
      requireOutput: () => gate,
      requirePassthrough: () => passthrough,
      disconnectNode: (node: { disconnect?: () => void } | null) => node?.disconnect?.(),
    } as unknown as AudioGraph;

    const engine = { ready: true, signalsmithNode: signalNode } as unknown as PitchEngine;

    const accompaniment = {
      ready: true,
      enabled: true,
      nodes: {
        crossover: wiredNode(),
        lowband: wiredNode(),
        signalsmith: wiredNode(),
        limiter: wiredNode(),
        delay: wiredNode(),
        mixBus: wiredNode(),
      },
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
