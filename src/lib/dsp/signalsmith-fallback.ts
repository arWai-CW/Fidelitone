/**
 * Signalsmith Stretch fallback — preserved for A/B comparison (Task 15)
 *
 * This module wraps the Signalsmith Stretch library for real-time pitch shifting.
 * It's kept separate from the main offscreen engine so we can compare
 * Signalsmith vs RubberBand LiveShifter performance.
 */

import SignalsmithStretch from "signalsmith-stretch";

export interface StretchNode extends AudioWorkletNode {
  schedule(options: {
    active?: boolean;
    semitones?: number;
    rate?: number;
    output?: number;
  }): Promise<void>;
}

export interface SignalsmithEngine {
  node: StretchNode;
  ready: boolean;
}

/**
 * Create a Signalsmith Stretch AudioWorkletNode
 */
export async function createSignalsmithEngine(
  ctx: AudioContext
): Promise<SignalsmithEngine | null> {
  try {
    const node = (await SignalsmithStretch(ctx)) as StretchNode;
    node.connect(ctx.destination);
    await node.schedule({
      active: true,
      semitones: 0,
      output: ctx.currentTime + 0.05,
    });
    console.log("[signalsmith-fallback] Signalsmith Stretch node ready");
    return { node, ready: true };
  } catch (err) {
    console.error("[signalsmith-fallback] Failed to create Signalsmith:", err);
    return null;
  }
}

/**
 * Set pitch on Signalsmith engine
 */
export function setSignalsmithPitch(
  engine: SignalsmithEngine | null,
  semitones: number,
  ctx: AudioContext
): void {
  if (!engine?.ready) return;
  engine.node.schedule({
    semitones,
    output: ctx.currentTime + 0.05,
  });
  console.log("[signalsmith-fallback] Pitch →", semitones, "semitones");
}

/**
 * Activate/deactivate Signalsmith engine
 */
export function setSignalsmithActive(
  engine: SignalsmithEngine | null,
  active: boolean,
  semitones: number,
  ctx: AudioContext
): void {
  if (!engine?.ready) return;
  engine.node.schedule({
    active,
    semitones,
    output: ctx.currentTime + 0.05,
  });
}
