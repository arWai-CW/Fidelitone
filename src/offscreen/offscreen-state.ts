import type { CaptureState as AudioCaptureState, Engine as AudioEngine } from "../lib/audio-state";

export type CaptureState = AudioCaptureState;
export type Engine = AudioEngine;

export const CROSSOVER_FREQ = 175;
export const ACCOMPANIMENT_ALIGN_DELAY_S = 0.09;
export const CROSSFADE_SEC = 0.05;

export function routeFor(options: {
  bypass: boolean;
  accompanimentMode: boolean;
  accompanimentReady: boolean;
  engine: Engine;
}): string {
  if (options.bypass) return "bypass";
  if (options.accompanimentMode && options.accompanimentReady) return "accompaniment";
  return options.engine;
}
