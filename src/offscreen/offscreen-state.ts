import type { CaptureState as AudioCaptureState, ProcessingSettings, SignalRoute as AudioSignalRoute } from "../lib/audio-state";

export type CaptureState = AudioCaptureState;
export type SignalRoute = AudioSignalRoute;

export const CROSSOVER_FREQ = 175;
export const ACCOMPANIMENT_ALIGN_DELAY_S = 0.09;

/**
 * Which path a captured stream is travelling through. `passthrough` is the
 * honest one: the engine failed to initialise, so the graph passes audio through
 * unprocessed and the popup says so rather than pretending (ADR-0007).
 */
export function routeFor(options: {
  bypass: boolean;
  accompanimentMode: boolean;
  accompanimentReady: boolean;
  engineReady: boolean;
}): SignalRoute {
  if (options.bypass) return "bypass";
  if (options.accompanimentMode && options.accompanimentReady) return "accompaniment";
  return options.engineReady ? "signalsmith" : "passthrough";
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
