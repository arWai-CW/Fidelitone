import {
  createSignalsmithEngine,
  setSignalsmithPitch,
  setSignalsmithPitchWithFormants,
  type SignalsmithEngine,
} from "../lib/dsp/signalsmith-fallback";
import type { AudioGraph } from "./audio-graph";

/**
 * The one pitch engine (ADR-0007): a Signalsmith Stretch worklet, plus pitch and
 * formant control scheduled against its own reported latency.
 *
 * ADR-0003's A/B switching is gone with Rubber Band, so this module no longer
 * chooses between engines or crossfades gains. What is left is the piece that
 * was always real: owning one engine's node and keeping its parameters in sync
 * with the page's settings.
 */
export class PitchEngine {
  private node: AudioWorkletNode | null = null;
  private initPromise: Promise<boolean> | null = null;

  constructor(
    private graph: AudioGraph,
    private createEngine = createSignalsmithEngine,
  ) {}

  get signalsmithNode(): AudioWorkletNode | null {
    return this.node;
  }

  get ready(): boolean {
    return this.node !== null;
  }

  /** Idempotent, and safe to call from several transitions at once. */
  async ensureReady(semitones: number, preserveFormants: boolean): Promise<boolean> {
    if (this.node) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.graph.ensureReady();
        const engine = await this.createEngine(this.graph.requireContext(), semitones);
        if (!engine?.node) return false;
        this.node = engine.node as unknown as AudioWorkletNode;
        console.log("[pitch-engine] Signalsmith engine initialized");
        await this.applyPitch(semitones, preserveFormants);
        return true;
      } catch (err) {
        console.error("[pitch-engine] Signalsmith init failed:", err);
        this.node = null;
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async applyPitch(semitones: number, preserveFormants: boolean): Promise<void> {
    if (!this.node) return;
    await setSignalsmithPitchWithFormants(
      { node: this.node as unknown as SignalsmithEngine["node"], ready: true },
      semitones,
      preserveFormants,
      this.graph.requireContext(),
    ).catch((err) => console.error("[pitch-engine] Pitch update failed:", err));
  }

  async setFormants(preserveFormants: boolean, semitones: number): Promise<void> {
    if (!this.node) return;
    await setSignalsmithPitchWithFormants(
      { node: this.node as unknown as SignalsmithEngine["node"], ready: true },
      semitones,
      preserveFormants,
      this.graph.requireContext(),
    ).catch((err) => console.error("[pitch-engine] Formant update failed:", err));
  }

  /**
   * Pitch without touching the formant option — for the accompaniment graph,
   * which owns the highband's formant setting itself and only needs the rate.
   */
  dryPitch(semitones: number): void {
    if (!this.node) return;
    void setSignalsmithPitch(
      { node: this.node as unknown as SignalsmithEngine["node"], ready: true },
      semitones,
      this.graph.requireContext(),
    ).catch((err) => console.error("[pitch-engine] Dry pitch update failed:", err));
  }

  reset(): void {
    this.graph.disconnectNode(this.node);
    this.node = null;
    this.initPromise = null;
  }
}
