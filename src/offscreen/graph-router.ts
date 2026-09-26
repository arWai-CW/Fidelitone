import type { AudioGraph } from "./audio-graph";
import type { PitchEngine } from "./pitch-engine";
import type { AccompanimentGraph } from "./accompaniment";

export interface GraphRoute {
  bypass: boolean;
  accompanimentMode: boolean;
}

export class GraphRouter {
  constructor(
    private graph: AudioGraph,
    private engine: PitchEngine,
    private accompaniment: AccompanimentGraph,
    private getSource: () => MediaStreamAudioSourceNode | null,
  ) {}

  /**
   * Disconnect everything, then reconnect only the active path. ADR-0001:
   * patching individual edges is what left a +6 dB residual gain behind, so
   * routing always starts from a fully torn-down graph.
   */
  rewire(): void {
    const source = this.getSource();
    source?.disconnect();
    this.graph.disconnectNode(this.accompaniment.nodes?.crossover ?? null);
    this.graph.disconnectNode(this.accompaniment.nodes?.lowband ?? null);
    this.graph.disconnectNode(this.engine.signalsmithNode);
    this.graph.disconnectNode(this.graph.passthroughNode);
    this.graph.disconnectNode(this.accompaniment.nodes?.delay ?? null);
    this.graph.disconnectNode(this.accompaniment.nodes?.mixBus ?? null);
    this.graph.disconnectNode(this.accompaniment.nodes?.limiter ?? null);
  }

  connectSource(route: GraphRoute): boolean {
    const source = this.getSource();
    if (!source || !this.graph.ready) {
      console.log("[offscreen] connectSource: skipped - source:", !!source, "graphReady:", this.graph.ready);
      return false;
    }

    return this.connectRoute(source, route);
  }

  private connectRoute(source: MediaStreamAudioSourceNode, route: GraphRoute): boolean {
    this.rewire();

    if (route.bypass) return this.connectPassthrough(source, "bypass");

    if (route.accompanimentMode && this.accompaniment.ready && this.accompaniment.nodes) {
      return this.connectAccompaniment(source);
    }

    const engineNode = this.engine.signalsmithNode;
    if (engineNode && this.engine.ready) {
      engineNode.connect(this.graph.requireOutput());
      source.connect(engineNode);
      console.log("[offscreen] Source → signalsmithNode → destination");
      return true;
    }

    // The engine is not up. Pass the audio through and let routeFor() report
    // "passthrough" so the popup can say the audio is unprocessed (ADR-0007).
    return this.connectPassthrough(source, "fallback");
  }

  private connectPassthrough(source: MediaStreamAudioSourceNode, reason: string): boolean {
    this.graph.requirePassthrough().connect(this.graph.requireOutput());
    source.connect(this.graph.requirePassthrough());
    console.log("[offscreen] Source → passthrough (" + reason + ")");
    return true;
  }

  private connectAccompaniment(source: MediaStreamAudioSourceNode): boolean {
    const nodes = this.accompaniment.nodes;
    if (!nodes) return false;

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
