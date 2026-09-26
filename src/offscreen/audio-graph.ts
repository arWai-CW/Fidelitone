import { postWorkletMessage } from "../lib/dsp/worklet-message";
import { OUTPUT_GATE_MS, createOutputGate, delayGate, scheduleGate } from "./output-gate";

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
  private outputGain: GainNode | null = null;
  private disposeGateWait: (() => void) | null = null;
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

  async ensureReady(): Promise<void> {
    if (this.graphReady) return;

    let initialization = this.graphInitializationPromise;
    if (!initialization) {
      initialization = this.initialize().catch((err) => {
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

  async teardown(): Promise<void> {
    this.graphGeneration += 1;

    disconnectNode(this.passthrough);
    disconnectNode(this.outputGain);
    this.disposeGateWait?.();
    this.disposeGateWait = null;

    this.passthrough = null;
    this.outputGain = null;
    this.graphReady = false;
    this.graphInitializationPromise = null;
  }

  private async initialize(): Promise<void> {
    const generation = ++this.graphGeneration;
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      console.log("[offscreen] AudioContext created, sampleRate:", this.ctx.sampleRate);

      if (!passthroughModuleLoaded) {
        await this.ctx.audioWorklet.addModule(chrome.runtime.getURL("processors/passthrough-processor.js"));
        passthroughModuleLoaded = true;
      }

      this.passthrough = new AudioWorkletNode(this.ctx, "passthrough");
      this.outputGain = createOutputGate(this.ctx);

      if (generation !== this.graphGeneration) throw new Error("Graph initialization was superseded");
      this.graphReady = true;
      console.log("[offscreen] Audio graph ready");
    } catch (err) {
      await this.teardown();
      throw err;
    }
  }
}
