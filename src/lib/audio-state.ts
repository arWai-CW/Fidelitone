export type Engine = "rubberband" | "signalsmith";

export interface EngineAvailability {
  signalsmith: boolean;
  rubberband: boolean;
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
}
