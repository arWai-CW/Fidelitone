import type {
  CaptureState as AudioCaptureState,
  Engine as AudioEngine,
  EngineAvailability as AudioEngineAvailability,
} from "../lib/audio-state";

export type CaptureState = AudioCaptureState;
export type Engine = AudioEngine;
export type EngineAvailability = AudioEngineAvailability;
export type ConnectionState = "disconnected" | "connecting" | "connected" | "lost";

export interface PopupState {
  connected: boolean;
  connecting: boolean;
  captureLost: boolean;
  bypass: boolean;
  selectedEngine: Engine;
  route: string | null;
  engineAvailability: EngineAvailability;
}

export const PITCH_MIN = -12;
export const PITCH_MAX = 12;

export function createPopupState(): PopupState {
  return {
    connected: false,
    connecting: false,
    captureLost: false,
    bypass: false,
    selectedEngine: "rubberband",
    route: null,
    engineAvailability: {
      signalsmith: false,
      rubberband: false,
    },
  };
}

export function isEngine(value: unknown): value is Engine {
  return value === "rubberband" || value === "signalsmith";
}

export function clampPitch(value: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, value));
}

export function roundPitch(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatSemitones(value: number): string {
  const rounded = roundPitch(value);
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded.toFixed(2)}`;
}

export function connectionState(state: PopupState): ConnectionState {
  if (state.connecting) return "connecting";
  if (state.captureLost) return "lost";
  if (state.connected) return "connected";
  return "disconnected";
}

export function isProcessingLocked(state: PopupState): boolean {
  return !state.connected || state.connecting || state.captureLost;
}

export function applyCaptureState(current: PopupState, capture: CaptureState): PopupState {
  const selectedEngine = isEngine(capture.selectedEngine)
    ? capture.selectedEngine
    : isEngine(capture.engine)
      ? capture.engine
      : current.selectedEngine;
  return {
    ...current,
    captureLost: capture.captureLost === true,
    bypass: capture.bypass === true,
    selectedEngine,
    route: capture.route ?? current.route,
    engineAvailability: capture.engineAvailability ?? {
      signalsmith: selectedEngine === "signalsmith",
      rubberband: selectedEngine === "rubberband",
    },
  };
}

export function setConnected(current: PopupState, connected: boolean): PopupState {
  return {
    ...current,
    connected,
    captureLost: connected ? current.captureLost : false,
  };
}

export function setConnecting(current: PopupState, connecting: boolean): PopupState {
  return { ...current, connecting };
}

export function setBypass(current: PopupState, bypass: boolean): PopupState {
  return { ...current, bypass };
}

export function selectEngine(current: PopupState, engine: Engine): PopupState {
  return { ...current, selectedEngine: engine };
}

