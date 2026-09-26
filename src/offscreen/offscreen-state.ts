import type { CaptureState as AudioCaptureState, Engine as AudioEngine, ProcessingSettings } from "../lib/audio-state";

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

/**
 * Emitted by the offscreen document whenever capture identity or liveness
 * changes, so the service worker can drive the badge without a popup open.
 */
export interface CaptureEvent {
  connected: boolean;
  captureLost: boolean;
  tabId: number | null;
  page: string | null;
}

/** Identity of the tab the capture belongs to. */
export interface CaptureTarget {
  tabId: number | null;
  page: string | null;
}

/** ADR-0004 atomic handover: settings first, then (optionally) the stream. */
export interface SwitchCaptureRequest {
  /** null keeps the current stream and only re-applies settings/identity. */
  streamId: string | null;
  tabId: number;
  page: string;
  settings: ProcessingSettings | null;
}
