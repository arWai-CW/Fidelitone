import { ACCOMPANIMENT_ALIGN_DELAY_S, CROSSOVER_FREQ } from "./offscreen-state";
import { semitonesToPitchScale } from "../lib/dsp/math";
import { postWorkletMessage } from "../lib/dsp/worklet-message";
import type { AudioGraph } from "./audio-graph";
import type { PitchEngine } from "./pitch-engine";

export interface AccompanimentNodes {
  crossover: AudioWorkletNode;
  lowband: AudioWorkletNode;
  signalsmith: AudioWorkletNode | null;
  limiter: DynamicsCompressorNode;
  delay: DelayNode;
  mixBus: GainNode;
}

export class AccompanimentGraph {
  private _enabled = false;
  private _ready = false;
  private initPromise: Promise<boolean> | null = null;
  private crossoverModuleLoaded = false;
  private resamplerModuleLoaded = false;
  private crossoverNode: AudioWorkletNode | null = null;
  private lowbandResamplerNode: AudioWorkletNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private accompanimentDelay: DelayNode | null = null;
  private accompanimentMixBus: GainNode | null = null;

  constructor(private graph: AudioGraph, private engine: PitchEngine) {}

  get enabled(): boolean {
    return this._enabled;
  }

  get ready(): boolean {
    return this._ready;
  }

  get nodes(): AccompanimentNodes | null {
    if (
      !this._ready ||
      !this.crossoverNode ||
      !this.lowbandResamplerNode ||
      !this.limiterNode ||
      !this.accompanimentDelay ||
      !this.accompanimentMixBus
    ) {
      return null;
    }
    return {
      crossover: this.crossoverNode,
      lowband: this.lowbandResamplerNode,
      signalsmith: this.engine.signalsmithNode,
      limiter: this.limiterNode,
      delay: this.accompanimentDelay,
      mixBus: this.accompanimentMixBus,
    };
  }

  async ensureEnabled(semitones: number, preserveFormants: boolean): Promise<boolean> {
    if (this._ready && this.nodes) return true;
    if (!(await this.init(semitones, preserveFormants))) {
      this._enabled = false;
      this.reset();
      return false;
    }
    return true;
  }

  async init(semitones: number, preserveFormants: boolean): Promise<boolean> {
    if (this._ready && this.nodes) return true;
    if (this.initPromise) return this.initPromise;

    const ownsEngine = !this.engine.ready;
    this.initPromise = (async () => {
      let newCrossover: AudioWorkletNode | null = null;
      let newLowbandResampler: AudioWorkletNode | null = null;
      let newLimiter: DynamicsCompressorNode | null = null;
      let newDelay: DelayNode | null = null;
      let newMixBus: GainNode | null = null;

      try {
        await this.graph.ensureReady();

        if (!this.crossoverModuleLoaded) {
          await this.graph.requireContext().audioWorklet.addModule(
            chrome.runtime.getURL("processors/crossover-processor.js"),
          );
          this.crossoverModuleLoaded = true;
        }
        if (!this.resamplerModuleLoaded) {
          await this.graph.requireContext().audioWorklet.addModule(
            chrome.runtime.getURL("processors/lowband-resampler.js"),
          );
          this.resamplerModuleLoaded = true;
        }

        const ctx = this.graph.requireContext();
        newCrossover = new AudioWorkletNode(ctx, "crossover", {
          numberOfInputs: 1,
          numberOfOutputs: 2,
          channelCount: 2,
          channelCountMode: "explicit",
          outputChannelCount: [2, 2],
        });
        newLowbandResampler = new AudioWorkletNode(ctx, "lowband-resampler", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 2,
          channelCountMode: "explicit",
          outputChannelCount: [2],
        });
        newLimiter = ctx.createDynamicsCompressor();
        newLimiter.threshold.value = -3;
        newLimiter.knee.value = 4;
        newLimiter.ratio.value = 8;
        newLimiter.attack.value = 0.003;
        newLimiter.release.value = 0.25;
        newDelay = ctx.createDelay(ACCOMPANIMENT_ALIGN_DELAY_S);
        newDelay.delayTime.value = ACCOMPANIMENT_ALIGN_DELAY_S;
        newMixBus = ctx.createGain();

        await postWorkletMessage(
          newCrossover,
          { type: "INIT", crossoverFreq: CROSSOVER_FREQ, channels: 2 },
          "INIT_OK",
          { label: "crossover", retries: 1, retryDelayMs: 250, timeoutMs: 10000 },
        );
        await postWorkletMessage(
          newLowbandResampler,
          {
            type: "INIT",
            channels: 2,
            pitchScale: semitonesToPitchScale(semitones),
            sampleRate: ctx.sampleRate,
          },
          "INIT_OK",
          { label: "lowband-resampler", retries: 1, retryDelayMs: 250, timeoutMs: 10000 },
        );

        if (!(await this.engine.ensureReady(semitones, preserveFormants)) || !this.engine.signalsmithNode) {
          throw new Error("Signalsmith Stretch could not be initialized");
        }
        this.engine.dryPitch(semitones);

        this.crossoverNode = newCrossover;
        this.lowbandResamplerNode = newLowbandResampler;
        this.limiterNode = newLimiter;
        this.accompanimentDelay = newDelay;
        this.accompanimentMixBus = newMixBus;
        this._ready = true;
        console.log("[offscreen] Accompaniment mode initialized");
        return true;
      } catch (err) {
        console.error("[offscreen] Accompaniment mode init failed:", err);
        this.graph.disconnectNode(newCrossover);
        this.graph.disconnectNode(newLowbandResampler);
        this.graph.disconnectNode(newLimiter);
        this.graph.disconnectNode(newDelay);
        this.graph.disconnectNode(newMixBus);
        if (ownsEngine && this.engine.ready) {
          this.graph.disconnectNode(this.engine.signalsmithNode);
          this.engine.reset();
        }
        this.reset();
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  resetWorklets(): void {
    this.graph.disconnectNode(this.crossoverNode);
    this.graph.disconnectNode(this.lowbandResamplerNode);
    this.crossoverNode = null;
    this.lowbandResamplerNode = null;
    this._ready = false;
  }

  reset(): void {
    this.graph.disconnectNode(this.crossoverNode);
    this.graph.disconnectNode(this.lowbandResamplerNode);
    this.graph.disconnectNode(this.limiterNode);
    this.graph.disconnectNode(this.accompanimentDelay);
    this.graph.disconnectNode(this.accompanimentMixBus);
    this.crossoverNode = null;
    this.lowbandResamplerNode = null;
    this.limiterNode = null;
    this.accompanimentDelay = null;
    this.accompanimentMixBus = null;
    this._ready = false;
  }

  deactivate(): void {
    this._enabled = false;
    this.reset();
  }

  applyDryPitch(semitones: number): void {
    if (this.lowbandResamplerNode) {
      this.lowbandResamplerNode.port.postMessage({
        type: "SET_PITCH",
        pitchScale: semitonesToPitchScale(semitones),
      });
    }
    this.engine.dryPitch(semitones);
  }
}
