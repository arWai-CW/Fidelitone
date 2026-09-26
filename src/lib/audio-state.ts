/** The path a captured stream is currently travelling through (ADR-0007). */
export type SignalRoute = "bypass" | "accompaniment" | "signalsmith" | "passthrough";

/** Fully resolved processing settings; the unit a page remembers and applies. */
export interface ProcessingSettings {
  pitch: number;
  bypass: boolean;
  preserveFormants: boolean;
  accompanimentMode: boolean;
}

export interface CaptureState {
  ready?: boolean;
  connected: boolean;
  pitch: number;
  bypass: boolean;
  preserveFormants: boolean;
  accompanimentMode: boolean;
  route?: SignalRoute;
  captureLost?: boolean;
  /** Identity of the tab being captured (null when idle/lost). */
  tabId?: number | null;
  page?: string | null;
}
