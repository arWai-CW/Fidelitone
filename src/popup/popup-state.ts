import type {
  CaptureState as AudioCaptureState,
  SignalRoute as AudioSignalRoute,
} from "../lib/audio-state";
import { isCrossTabCapture, isSettingsMismatch } from "../lib/page-settings";

export type CaptureState = AudioCaptureState;
export type SignalRoute = AudioSignalRoute;
export type ConnectionState = "disconnected" | "connecting" | "connected" | "lost";

export interface PopupState {
  connected: boolean;
  connecting: boolean;
  captureLost: boolean;
  bypass: boolean;
  /** The path the audio is actually travelling through (ADR-0007). */
  route: SignalRoute | null;
  /** Tab the audio actually belongs to (may differ from the active tab). */
  capturedTabId: number | null;
  /** Page URL of that tab (see pageKey); the key its settings live under. */
  capturedPage: string | null;
  /** Tab the popup was opened on, and the page that tab is showing. */
  activeTabId: number | null;
  activePage: string | null;
}

export const PITCH_MIN = -12;
export const PITCH_MAX = 12;

export function createPopupState(): PopupState {
  return {
    connected: false,
    connecting: false,
    captureLost: false,
    bypass: false,
    route: null,
    capturedTabId: null,
    capturedPage: null,
    activeTabId: null,
    activePage: null,
  };
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
 * Controls edit one page's record, so they only move while the active tab sits
 * on that same page URL (ADR-0004, amended to per-URL memory). Another page is
 * another record, so anything else stays locked until the capture follows.
 */
export function isSettingsLocked(state: PopupState): boolean {
  return isSettingsMismatch(
    { tabId: state.capturedTabId, page: state.capturedPage },
    { tabId: state.activeTabId, page: state.activePage },
  );
}

export function isProcessingLocked(state: PopupState): boolean {
  return !state.connected || state.connecting || state.captureLost || isSettingsLocked(state);
}

/**
 * The audio can belong to another tab, so the popup says where the sound is
 * coming from and offers a re-capture. Whether the controls follow is decided
 * by isSettingsLocked: two tabs on the same page URL share one record.
 */
export function showDivergenceBanner(state: PopupState): boolean {
  if (!state.connected || state.captureLost || state.capturedTabId === null) return false;
  return isCrossTabCapture(
    { tabId: state.capturedTabId, page: state.capturedPage },
    { tabId: state.activeTabId, page: state.activePage },
  );
}

export function applyCaptureState(current: PopupState, capture: CaptureState): PopupState {
  return {
    ...current,
    captureLost: capture.captureLost === true,
    bypass: capture.bypass === true,
    route: capture.route ?? current.route,
    capturedTabId: typeof capture.tabId === "number" ? capture.tabId : null,
    capturedPage: typeof capture.page === "string" ? capture.page : null,
  };
}

export function setActiveTab(
  current: PopupState,
  tab: { id?: number | null; page?: string | null },
): PopupState {
  return {
    ...current,
    activeTabId: typeof tab.id === "number" ? tab.id : null,
    activePage: tab.page ?? null,
  };
}

/** Records where the audio actually lives (used when GET_STATE is unavailable). */
export function setCaptureIdentity(
  current: PopupState,
  tab: { id?: number | null; page?: string | null },
): PopupState {
  return {
    ...current,
    capturedTabId: typeof tab.id === "number" ? tab.id : null,
    capturedPage: typeof tab.page === "string" ? tab.page : null,
  };
}

export function setConnected(current: PopupState, connected: boolean): PopupState {
  return {
    ...current,
    connected,
    captureLost: connected ? current.captureLost : false,
    capturedTabId: connected ? current.capturedTabId : null,
    capturedPage: connected ? current.capturedPage : null,
  };
}

export function setConnecting(current: PopupState, connecting: boolean): PopupState {
  return { ...current, connecting };
}

export function setBypass(current: PopupState, bypass: boolean): PopupState {
  return { ...current, bypass };
}
