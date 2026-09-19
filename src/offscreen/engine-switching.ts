import {
  createSignalsmithEngine,
  setSignalsmithPitch,
  setSignalsmithPitchWithFormants,
  type SignalsmithEngine,
} from "../lib/dsp/signalsmith-fallback";
import { effectiveEngine, engineGainValues } from "./audio-routing";
import type { Engine } from "./offscreen-state";
import type { AudioGraph } from "./audio-graph";

export interface EngineStatus {
  signalsmithReady: boolean;
  signalsmithNode: unknown;
  rubberbandReady: boolean;
  rubberbandNode: unknown;
}

export interface EngineConnection {
  connected: boolean;
  bypass: boolean;
  accompanimentMode: boolean;
}

export type ConnectSource = (preserveGains?: boolean) => boolean;
export type ApplyPitch = () => void | Promise<void>;

function resetGain(gain: GainNode | null, value: number, ctx: AudioContext): void {
  if (!gain) return;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(value, ctx.currentTime);
}

export class EngineSwitching {
  private _activeEngine: Engine = "rubberband";
  private _signalsmithNode: AudioWorkletNode | null = null;
  private _signalsmithReady = false;
  private _signalsmithInitPromise: Promise<boolean> | null = null;

  constructor(private graph: AudioGraph, private createEngine = createSignalsmithEngine) {}

  get signalsmithNode(): AudioWorkletNode | null {
    return this._signalsmithNode;
  }

  get selectedEngine(): Engine {
    return this._activeEngine;
  }

  get signalsmithAvailable(): boolean {
    return this._signalsmithReady && !!this._signalsmithNode;
  }

  get availability() {
    return {
      signalsmith: this.signalsmithAvailable,
      rubberband: this.graph.rubberbandReadyStatus && !!this.graph.rubberbandNode,
    };
  }

  effectiveEngine(): Engine {
    return effectiveEngine(this._activeEngine, {
      signalsmithReady: this._signalsmithReady,
      signalsmithNode: this._signalsmithNode,
      rubberbandReady: this.graph.rubberbandReadyStatus,
      rubberbandNode: this.graph.rubberbandNode,
    });
  }

  setGains(engine = this._activeEngine): void {
    const values = engineGainValues(engine);
    const ctx = this.graph.context;
    if (!ctx) return;
    resetGain(this.graph.gainANode, values.signalsmith, ctx);
    resetGain(this.graph.gainBNode, values.rubberband, ctx);
  }

  crossfade(from: "rubberband" | "signalsmith", to: "rubberband" | "signalsmith"): void {
    if (!this.graph.gainANode || !this.graph.gainBNode || !this.graph.context || from === to) return;
    const outGain = from === "rubberband" ? this.graph.gainBNode : this.graph.gainANode;
    const inGain = to === "rubberband" ? this.graph.gainBNode : this.graph.gainANode;
    const now = this.graph.context.currentTime;

    outGain.gain.cancelScheduledValues(now);
    outGain.gain.setValueAtTime(outGain.gain.value, now);
    outGain.gain.linearRampToValueAtTime(0, now + 0.05);
    inGain.gain.cancelScheduledValues(now);
    inGain.gain.setValueAtTime(inGain.gain.value, now);
    inGain.gain.linearRampToValueAtTime(1, now + 0.05);

    console.log(`[A/B] Switched from ${from} to ${to} at T+${(performance.now() / 1000).toFixed(3)}s`);
  }

  async initSignalsmith(semitones: number, preserveFormants: boolean): Promise<boolean> {
    if (this._signalsmithReady && this._signalsmithNode) return true;
    if (this._signalsmithInitPromise) return this._signalsmithInitPromise;

    this._signalsmithInitPromise = (async () => {
      const previousNode = this._signalsmithNode;
      const previousReady = this._signalsmithReady;
      try {
        await this.graph.ensureReady(semitones, preserveFormants);
        const engine = await this.createEngine(
          this.graph.requireContext(),
          semitones,
        );
        if (!engine?.node) return false;
        this._signalsmithNode = engine.node as unknown as AudioWorkletNode;
        this._signalsmithReady = true;
        console.log("[A/B] Signalsmith engine initialized");

        await setSignalsmithPitchWithFormants(
          { node: this.signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
          semitones,
          preserveFormants,
          this.graph.requireContext(),
        ).catch((err) => console.error("[offscreen] Signalsmith initial pitch/formant update failed:", err));

        return true;
      } catch (err) {
        console.error("[A/B] Signalsmith init failed:", err);
        if (this._signalsmithNode && this._signalsmithNode !== previousNode) this.graph.disconnectNode(this._signalsmithNode);
        this._signalsmithNode = previousNode;
        this._signalsmithReady = previousReady;
        return false;
      } finally {
        this._signalsmithInitPromise = null;
      }
    })();

    return this._signalsmithInitPromise;
  }

  async setEngine(
    engine: Engine,
    connection: EngineConnection,
    connectSource: ConnectSource,
    applyPitch: ApplyPitch,
    semitones = 0,
    preserveFormants = false,
  ): Promise<boolean> {
    await this.graph.ensureReady(semitones, preserveFormants);
    let available =
      engine === "rubberband"
        ? this.graph.rubberbandReadyStatus && !!this.graph.rubberbandNode
        : this.signalsmithAvailable;
    if (!available && engine === "signalsmith") {
      const initialized = await this.initSignalsmith(semitones, preserveFormants);
      available = !!(initialized && this._signalsmithNode);
    }
    if (!available) return false;

    const previousEngine = this._activeEngine;
    if (previousEngine === engine) {
      if (connection.connected && !connection.bypass && !connection.accompanimentMode && !connectSource(true)) {
        return false;
      }
      return true;
    }

    this._activeEngine = engine;
    if (connection.connected && !connection.bypass && !connection.accompanimentMode) {
      if (!connectSource(true)) {
        this._activeEngine = previousEngine;
        this.setGains(previousEngine);
        if (connection.connected) connectSource();
        return false;
      }
      this.crossfade(previousEngine, engine);
      void applyPitch();
    } else {
      this.setGains(engine);
    }

    console.log("[offscreen] Engine →", engine);
    return true;
  }

  async applyPitch(semitones: number, preserveFormants: boolean): Promise<void> {
    if (!this._signalsmithReady || !this._signalsmithNode) return;
    await setSignalsmithPitchWithFormants(
      { node: this._signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
      semitones,
      preserveFormants,
      this.graph.requireContext(),
    ).catch((err) => console.error("[offscreen] Signalsmith pitch update failed:", err));
  }

  async setFormants(preserveFormants: boolean, semitones: number): Promise<void> {
    if (!this._signalsmithReady || !this._signalsmithNode) return;
    await setSignalsmithPitchWithFormants(
      { node: this._signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
      semitones,
      preserveFormants,
      this.graph.requireContext(),
    ).catch((err) => console.error("[offscreen] Signalsmith formant update failed:", err));
  }

  dryPitch(semitones: number): void {
    if (!this._signalsmithReady || !this._signalsmithNode) return;
    void setSignalsmithPitch(
      { node: this._signalsmithNode as unknown as SignalsmithEngine["node"], ready: true },
      semitones,
      this.graph.requireContext(),
    ).catch((err) => console.error("[offscreen] Signalsmith dry pitch update failed:", err));
  }

  reset(): void {
    this.graph.disconnectNode(this._signalsmithNode);
    this._signalsmithNode = null;
    this._signalsmithReady = false;
    this._signalsmithInitPromise = null;
  }
}
