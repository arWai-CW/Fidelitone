/**
 * Signalsmith Stretch — Web Audio/WASM pitch shifter.
 *
 * The npm package embeds its WASM binary but normally registers its worklet
 * through a blob URL. Extension pages cannot reliably load that blob under the
 * MV3 CSP, so the build copies the package module to a static extension asset
 * and this wrapper points the factory at that asset.
 */

import SignalsmithStretch from "signalsmith-stretch";

const SIGNALSMITH_WORKLET_URL = "processors/signalsmith-stretch.js";

type SignalsmithFactory = typeof SignalsmithStretch & {
  moduleUrl?: string;
};

export interface StretchNode extends AudioWorkletNode {
  configure(options: {
    blockMs?: number | null;
    intervalMs?: number;
    splitComputation?: boolean;
    preset?: "default" | "cheaper";
  }): Promise<void>;
  latency(): Promise<number>;
  schedule(options: {
    active?: boolean;
    semitones?: number;
    rate?: number;
    output?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
  }): Promise<void>;
}

export interface SignalsmithEngine {
  node: StretchNode;
  ready: boolean;
}

/**
 * Create a Signalsmith Stretch AudioWorkletNode without using a blob URL.
 */
export async function createSignalsmithEngine(
  ctx: AudioContext,
  semitones = 0
): Promise<SignalsmithEngine | null> {
  let node: StretchNode | null = null;
  try {
    const factory = SignalsmithStretch as SignalsmithFactory;
    factory.moduleUrl = chrome.runtime.getURL(SIGNALSMITH_WORKLET_URL);

    node = (await factory(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })) as StretchNode;

    // These three numbers set the engine's latency, and the latency is load
    // bearing: `ACCOMPANIMENT_ALIGN_DELAY_S` (offscreen-state.ts) is a hand-tuned
    // constant that aligns the accompaniment graph's lowband path against this
    // one. Measured with tools/latency-probe (`npm run latency`):
    //
    //   blockMs 80 / intervalMs 20 / splitComputation true   -> 100 ms
    //   blockMs 80 / intervalMs 20 / splitComputation false  ->  80 ms
    //   blockMs 40 / intervalMs 10 / splitComputation true   ->  50 ms
    //   blockMs 20 / intervalMs  5 / splitComputation true   ->  25 ms
    //
    // Changing blockMs here without re-deriving the alignment constant makes the
    // two accompaniment bands arrive at different times, which is audible as
    // phasing between the bass and everything above 175 Hz. Re-run the probe
    // before touching this.
    const blockMs = 80;
    const intervalMs = 20;
    await node.configure({ blockMs, intervalMs, splitComputation: true });
    const latency = await node.latency();
    await node.schedule({
      active: true,
      semitones,
      output: ctx.currentTime + Math.max(0.05, latency),
    });

    console.log(
      `[signalsmith-fallback] Signalsmith Stretch ready, latency ${(latency * 1000).toFixed(1)} ms ` +
      `(blockMs ${blockMs}, intervalMs ${intervalMs})`,
    );
    return { node, ready: true };
  } catch (err) {
    node?.disconnect();
    console.error("[signalsmith-fallback] Failed to create Signalsmith:", err);
    return null;
  }
}

/**
 * Set pitch on Signalsmith engine.
 */
export async function setSignalsmithPitch(
  engine: SignalsmithEngine | null,
  semitones: number,
  ctx: AudioContext
): Promise<void> {
  if (!engine?.ready) return;
  const latency = await engine.node.latency();
  await engine.node.schedule({
    semitones,
    output: ctx.currentTime + Math.max(0.05, latency),
  });
  console.log("[signalsmith-fallback] Pitch →", semitones, "semitones");
}

/**
 * Set pitch with formant preservation on Signalsmith engine.
 */
export async function setSignalsmithPitchWithFormants(
  engine: SignalsmithEngine | null,
  semitones: number,
  preserveFormants: boolean,
  ctx: AudioContext
): Promise<void> {
  if (!engine?.ready) return;
  const latency = await engine.node.latency();
  await engine.node.schedule({
    semitones,
    formantSemitones: 0,
    formantCompensation: preserveFormants,
    formantBaseHz: 0, // 0 = auto-detect
    output: ctx.currentTime + Math.max(0.05, latency),
  });
  console.log("[signalsmith-fallback] Pitch →", semitones, "semitones, formant preservation:", preserveFormants);
}
