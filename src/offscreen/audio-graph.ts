import {
  loadRubberBandWasm,
  RubberBandLiveShifter,
  RUBBERBAND_FORMANT_PRESERVED,
  RUBBERBAND_OFFSCREEN_OPTIONS,
} from "../lib/dsp/rubberband-live-shifter";
import { semitonesToPitchScale } from "../lib/dsp/math";
import { postWorkletMessage } from "../lib/dsp/worklet-message";
import { OUTPUT_GATE_MS, delayGate, scheduleGate } from "./output-gate";

let rubberbandModuleLoaded = false;
let passthroughModuleLoaded = false;

function disconnectNode(node: AudioNode | null | undefined): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // A node may already be disconnected during graph teardown.
  }
}

export class AudioGraph {
  private ctx: AudioContext | null = null;
  private passthrough: AudioWorkletNode | null = null;
  private rbNode: AudioWorkletNode | null = null;
  private liveShifter: RubberBandLiveShifter | null = null;
  private gainA: GainNode | null = null;
  private gainB: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private disposeGateWait: (() => void) | null = null;
  private rbBlockSize = 512;
  private rbChannels = 2;
  private rubberbandReady = false;
  private graphReady = false;
  private graphInitializationPromise: Promise<void> | null = null;
  private graphGeneration = 0;

  get context(): AudioContext | null {
    return this.ctx;
  }

  get ready(): boolean {
    return this.graphReady;
  }

  get passthroughNode(): AudioWorkletNode | null {
    return this.passthrough;
  }

  get rubberbandNode(): AudioWorkletNode | null {
    return this.rbNode;
  }

  get rubberbandReadyStatus(): boolean {
    return this.rubberbandReady;
  }

  get rubberbandBlockSize(): number {
    return this.rbBlockSize;
  }

  get rubberbandChannels(): number {
    return this.rbChannels;
  }

  get gainANode(): GainNode | null {
    return this.gainA;
  }

  get gainBNode(): GainNode | null {
    return this.gainB;
  }

  /** Master gate every path ends at, between the graph and ctx.destination. */
  get outputNode(): GainNode | null {
    return this.outputGain;
  }

  requireContext(): AudioContext {
    if (!this.ctx) throw new Error("Audio graph is not ready");
    return this.ctx;
  }

  requireOutput(): GainNode {
    if (!this.outputGain) throw new Error("Output gate is not ready");
    return this.outputGain;
  }

  /**
   * Ramps the output gate. Resolves when the ramp has actually taken effect,
   * so a handover can order "mute → change → unmute" precisely.
   */
  async fadeOutput(to: 0 | 1, durationMs = OUTPUT_GATE_MS): Promise<void> {
    const target = this.outputGain && this.ctx ? { param: this.outputGain.gain, currentTime: this.ctx.currentTime } : null;
    if (!scheduleGate(target, to, durationMs)) return;
    await delayGate(durationMs, (dispose) => {
      const previous = this.disposeGateWait;
      this.disposeGateWait = dispose;
      previous?.();
    });
  }

  fadeOut(durationMs = OUTPUT_GATE_MS): Promise<void> {
    return this.fadeOutput(0, durationMs);
  }

  fadeIn(durationMs = OUTPUT_GATE_MS): Promise<void> {
    return this.fadeOutput(1, durationMs);
  }

  requirePassthrough(): AudioWorkletNode {
    if (!this.passthrough) throw new Error("Passthrough worklet is not ready");
    return this.passthrough;
  }

  createMediaStreamSource(stream: MediaStream): MediaStreamAudioSourceNode {
    return this.requireContext().createMediaStreamSource(stream);
  }

  disconnectNode(node: AudioNode | null | undefined): void {
    disconnectNode(node);
  }

  async resetWorklet(node: AudioWorkletNode | null): Promise<void> {
    if (!node) return;
    try {
      await postWorkletMessage(node, { type: "RESET" }, "RESET_OK", {
        label: "audio worklet",
        timeoutMs: 750,
      });
    } catch (err) {
      console.warn("[offscreen] Worklet reset acknowledgement failed:", err);
    }
  }

  async ensureReady(semitones: number, preserveFormants: boolean): Promise<void> {
    if (this.graphReady) return;

    let initialization = this.graphInitializationPromise;
    if (!initialization) {
      initialization = this.initialize(semitones, preserveFormants).catch((err) => {
        this.graphReady = false;
        throw err;
      });
      this.graphInitializationPromise = initialization;
    }

    try {
      await initialization;
    } finally {
      if (this.graphInitializationPromise === initialization) {
        this.graphInitializationPromise = null;
      }
    }
  }

  setPitchScale(pitchScale: number): void {
    this.liveShifter?.setPitchScale(pitchScale);
  }

  setFormantOption(preserve: boolean): void {
    if (!this.liveShifter?.isInitialized) {
      console.warn("[offscreen] setFormantOption: state is 0, skipping");
      return;
    }
    const option = preserve ? RUBBERBAND_FORMANT_PRESERVED : 0;
    console.log("[offscreen] setFormantOption: preserve=", preserve, "option=0x" + option.toString(16));
    this.liveShifter.setFormantOption(preserve);
    console.log("[offscreen] setFormantOption: called successfully");
  }

  async teardown(): Promise<void> {
    this.graphGeneration += 1;
    await this.resetWorklet(this.rbNode);

    disconnectNode(this.passthrough);
    disconnectNode(this.rbNode);
    disconnectNode(this.gainA);
    disconnectNode(this.gainB);
    disconnectNode(this.outputGain);
    this.deleteLiveShifter();

    this.passthrough = null;
    this.rbNode = null;
    this.gainA = null;
    this.gainB = null;
    this.disposeGateWait?.();
    this.disposeGateWait = null;
    this.outputGain = null;
    this.rubberbandReady = false;
    this.graphReady = false;
    this.graphInitializationPromise = null;
  }

  private async initialize(semitones: number, preserveFormants: boolean): Promise<void> {
    const generation = ++this.graphGeneration;
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      console.log("[offscreen] AudioContext created, sampleRate:", this.ctx.sampleRate);

      const wasmOk = await this.loadWasm();

      if (!rubberbandModuleLoaded) {
        await this.ctx.audioWorklet.addModule(chrome.runtime.getURL("processors/rubberband-processor.js"));
        rubberbandModuleLoaded = true;
      }
      if (!passthroughModuleLoaded) {
        await this.ctx.audioWorklet.addModule(chrome.runtime.getURL("processors/passthrough-processor.js"));
        passthroughModuleLoaded = true;
      }

      this.passthrough = new AudioWorkletNode(this.ctx, "passthrough");
      this.gainA = this.ctx.createGain();
      this.gainB = this.ctx.createGain();
      this.outputGain = this.ctx.createGain();
      this.outputGain.gain.value = 1;

      if (wasmOk) {
        const rbInit = this.initLiveShifter(this.ctx.sampleRate, 2, semitonesToPitchScale(semitones), preserveFormants);
        if (rbInit) {
          this.rbBlockSize = rbInit.blockSize;
          const node = new AudioWorkletNode(this.ctx, "rubberband", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 2,
            channelCountMode: "explicit",
            outputChannelCount: [2],
          });
          this.rbNode = node;
          node.port.onmessage = (e: MessageEvent) => {
            const msg = e.data;
            if (msg.type === "PROCESS") {
              if (!this.liveShifter?.isInitialized) return;
              const channels: Float32Array[] = msg.channels;
              if (!channels || channels.length !== this.rbChannels) return;
              const outChannels: Float32Array[] = channels.map(() => new Float32Array(this.rbBlockSize));
              this.liveShifter.shift(channels, outChannels);
              node.port.postMessage({ type: "OUTPUT_READY", channels: outChannels });
            }
          };
          node.connect(this.gainB);
          await postWorkletMessage(node, { type: "INIT", blockSize: this.rbBlockSize, channels: this.rbChannels }, "INIT_OK", {
            label: "rubberband",
            timeoutMs: 3000,
          });
          this.rubberbandReady = true;
          console.log("[offscreen] RubberBand ready, blockSize:", this.rbBlockSize, "startDelay:", rbInit.startDelay);
        } else {
          console.warn("[offscreen] LiveShifter initialization failed; passthrough fallback enabled");
        }
      } else {
        console.warn("[offscreen] WASM not loaded, passthrough only");
      }

      if (generation !== this.graphGeneration) throw new Error("Graph initialization was superseded");
      this.graphReady = true;
      console.log("[offscreen] Audio graph ready");
    } catch (err) {
      await this.teardown();
      throw err;
    }
  }

  private async loadWasm(): Promise<boolean> {
    const exports = await loadRubberBandWasm();
    if (!exports) return false;
    this.liveShifter = new RubberBandLiveShifter(exports, RUBBERBAND_OFFSCREEN_OPTIONS);
    console.log("[offscreen] WASM loaded");
    return true;
  }

  private initLiveShifter(
    sampleRate: number,
    channels: number,
    pitchScale: number,
    preserveFormants: boolean,
  ): { blockSize: number; startDelay: number } | null {
    this.rbChannels = channels;
    try {
      const initialized = this.liveShifter?.init(sampleRate, channels, pitchScale, preserveFormants);
      if (!initialized) return null;
      return { blockSize: initialized.blockSize, startDelay: initialized.startDelay };
    } catch (err) {
      console.error("[offscreen] LiveShifter initialization failed:", err);
      return null;
    }
  }

  private deleteLiveShifter(): void {
    this.liveShifter?.delete();
    this.liveShifter = null;
    this.rbBlockSize = 512;
  }
}
