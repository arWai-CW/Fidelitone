import type { AudioGraph } from "./audio-graph";
import type { EngineSwitching } from "./engine-switching";
import type { AccompanimentGraph } from "./accompaniment";

export interface GraphRoute {
  bypass: boolean;
  accompanimentMode: boolean;
}

export class GraphRouter {
  constructor(
    private graph: AudioGraph,
    private engine: EngineSwitching,
    private accompaniment: AccompanimentGraph,
    private getSource: () => MediaStreamAudioSourceNode | null,
  ) {}

  rewire(resetGains = true): void {
    const source = this.getSource();
    source?.disconnect();
    this.graph.disconnectNode(this.graph.rubberbandNode);
    this.graph.disconnectNode(this.accompaniment.nodes?.crossover ?? null);
    this.graph.disconnectNode(this.accompaniment.nodes?.lowband ?? null);
    this.graph.disconnectNode(this.engine.signalsmithNode);
    this.graph.disconnectNode(this.graph.passthroughNode);
    this.graph.disconnectNode(this.graph.gainANode);
    this.graph.disconnectNode(this.graph.gainBNode);
    this.graph.disconnectNode(this.accompaniment.nodes?.delay ?? null);
    this.graph.disconnectNode(this.accompaniment.nodes?.mixBus ?? null);
    this.graph.disconnectNode(this.accompaniment.nodes?.limiter ?? null);

    if (resetGains) {
      this.engine.setGains(this.engine.effectiveEngine());
    }
  }

  connectSource(route: GraphRoute, preserveGains = false): boolean {
    const source = this.getSource();
    if (!source || !this.graph.ready) {
      console.log("[offscreen] connectSource: skipped - source:", !!source, "graphReady:", this.graph.ready);
      return false;
    }

    if (route.bypass) {
      this.rewire();
      this.graph.requirePassthrough().connect(this.graph.requireOutput());
      source.connect(this.graph.requirePassthrough());
      console.log("[offscreen] Source → passthrough (bypass)");
      return true;
    }

    if (route.accompanimentMode && this.accompaniment.ready && this.accompaniment.nodes) {
      return this.connectAccompaniment(source, route.bypass);
    }

    this.rewire(!preserveGains);
    let connected = false;
    if (this.graph.rubberbandNode && this.graph.rubberbandReadyStatus && this.graph.gainBNode) {
      this.graph.rubberbandNode.connect(this.graph.gainBNode);
      this.graph.gainBNode.connect(this.graph.requireOutput());
      source.connect(this.graph.rubberbandNode);
      connected = true;
      console.log("[offscreen] Source → rbNode → gainB → destination (RubberBand)");
    }
    const signalNode = this.engine.signalsmithNode;
    if (signalNode && this.engine.signalsmithAvailable && this.graph.gainANode) {
      signalNode.connect(this.graph.gainANode);
      this.graph.gainANode.connect(this.graph.requireOutput());
      source.connect(signalNode);
      connected = true;
      console.log("[offscreen] Source → signalsmithNode → gainA → destination (Signalsmith)");
    }
    if (!connected) {
      this.graph.requirePassthrough().connect(this.graph.requireOutput());
      source.connect(this.graph.requirePassthrough());
      console.log("[offscreen] Source → passthrough (fallback)");
    } else {
      console.log("[offscreen] Source → engines (active:", this.engine.effectiveEngine(), ")");
    }
    return connected;
  }

  private connectAccompaniment(source: MediaStreamAudioSourceNode, bypass: boolean): boolean {
    const nodes = this.accompaniment.nodes;
    if (!nodes) return false;
    this.rewire();
    if (bypass) {
      this.graph.requirePassthrough().connect(this.graph.requireOutput());
      source.connect(this.graph.requirePassthrough());
      console.log("[offscreen] Source → passthrough (bypass)");
      return true;
    }

    source.connect(nodes.crossover);
    nodes.crossover.connect(nodes.lowband, 0);
    nodes.lowband.connect(nodes.delay);
    nodes.delay.connect(nodes.mixBus);
    if (nodes.signalsmith) {
      nodes.crossover.connect(nodes.signalsmith, 1);
      nodes.signalsmith.connect(nodes.mixBus);
    }
    nodes.mixBus.connect(nodes.limiter);
    nodes.limiter.connect(this.graph.requireOutput());

    console.log("[offscreen] Source → stereo sum (crossover → lowband resampler + Signalsmith → mixBus → limiter)");
    return true;
  }
}
