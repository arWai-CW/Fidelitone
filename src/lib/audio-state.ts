export type Engine = "rubberband" | "signalsmith";

export interface EngineAvailability {
  signalsmith: boolean;
  rubberband: boolean;
}

/** Fully resolved processing settings; the unit a page remembers and applies. */
export interface ProcessingSettings {
  pitch: number;
  bypass: boolean;
  preserveFormants: boolean;
  accompanimentMode: boolean;
  engine: Engine;
}

export interface CaptureState {
  ready?: boolean;
  connected: boolean;
  pitch: number;
  bypass: boolean;
  preserveFormants: boolean;
  accompanimentMode: boolean;
  engine?: Engine;
  selectedEngine?: Engine;
  route?: string;
  captureLost?: boolean;
  engineAvailability?: EngineAvailability;
  /** Identity of the tab currently being captured (null when idle/lost). */
  tabId?: number | null;
  /** Page URL of the capture (see pageKey); the key its settings live under. */
  page?: string | null;
}
