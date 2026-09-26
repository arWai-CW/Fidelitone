import type {
  CaptureState as AudioCaptureState,
  Engine as AudioEngine,
  EngineAvailability as AudioEngineAvailability,
} from "../lib/audio-state";
import { DEFAULT_ENGINE } from "../lib/site-settings";

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
  /** Tab the audio actually belongs to (may differ from the active tab). */
  capturedTabId: number | null;
  /** Origin the captured tab is on; the key its settings are remembered under. */
  capturedOrigin: string | null;
  activeTabId: number | null;
  activeOrigin: string | null;
}

export const PITCH_MIN = -12;
export const PITCH_MAX = 12;

export function createPopupState(): PopupState {
  return {
    connected: false,
    connecting: false,
    captureLost: false,
    bypass: false,
    selectedEngine: DEFAULT_ENGINE,
    route: null,
    engineAvailability: {
      signalsmith: false,
      rubberband: false,
    },
    capturedTabId: null,
    capturedOrigin: null,
    activeTabId: null,
    activeOrigin: null,
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

/**
 * Controls edit the captured site, so they only move when the active tab sits
 * on that same origin (ADR-0004).
 */
export function isSettingsLocked(state: PopupState): boolean {
  return state.capturedOrigin !== state.activeOrigin;
}

export function isProcessingLocked(state: PopupState): boolean {
  return !state.connected || state.connecting || state.captureLost || isSettingsLocked(state);
}

/**
 * The audio can belong to another tab on the same site: settings then stay
 * editable, but the popup must say where the sound is coming from.
 */
export function showDivergenceBanner(state: PopupState): boolean {
  return (
    state.connected &&
    !state.captureLost &&
    state.capturedTabId !== null &&
    state.capturedTabId !== state.activeTabId
  );
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
    capturedTabId: typeof capture.tabId === "number" ? capture.tabId : null,
    capturedOrigin: typeof capture.origin === "string" ? capture.origin : null,
  };
}

export function setActiveTab(
  current: PopupState,
  tab: { id?: number | null; origin?: string | null },
): PopupState {
  return {
    ...current,
    activeTabId: typeof tab.id === "number" ? tab.id : null,
    activeOrigin: tab.origin ?? null,
  };
}

/** Records where the audio actually lives (used when GET_STATE is unavailable). */
export function setCaptureIdentity(
  current: PopupState,
  tab: { id?: number | null; origin?: string | null },
): PopupState {
  return {
    ...current,
    capturedTabId: typeof tab.id === "number" ? tab.id : null,
    capturedOrigin: tab.origin ?? null,
  };
}

export function setConnected(current: PopupState, connected: boolean): PopupState {
  return {
    ...current,
    connected,
    captureLost: connected ? current.captureLost : false,
    capturedTabId: connected ? current.capturedTabId : null,
    capturedOrigin: connected ? current.capturedOrigin : null,
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
