// Pure capture-session state machine used by the background service worker.
// The service worker holds this only as a cache: every decision reconciles it
// against the offscreen document, which owns the real capture (ADR-0004).

import type { CaptureState } from "../lib/audio-state";
import type { CaptureEvent } from "../offscreen/offscreen-state";
import type { BadgeInput } from "../lib/site-settings";

export interface CaptureSession {
  capturedTabId: number | null;
  capturedOrigin: string | null;
  connected: boolean;
  captureLost: boolean;
}

export const EMPTY_SESSION: CaptureSession = {
  capturedTabId: null,
  capturedOrigin: null,
  connected: false,
  captureLost: false,
};

/** Auto-follow only runs inside a live capture session. */
export function hasActiveCapture(session: CaptureSession): boolean {
  return session.connected && !session.captureLost;
}

/**
 * Applies an offscreen CAPTURE_EVENT (connected / lost / identity). The event
 * is authoritative for identity too: a stop clears it, a loss keeps it.
 */
export function sessionFromEvent(event: CaptureEvent): CaptureSession {
  return {
    capturedTabId: event.tabId,
    capturedOrigin: event.origin,
    connected: event.connected,
    captureLost: event.captureLost,
  };
}

/** Rebuilds the cache from an authoritative GET_STATE snapshot. */
export function sessionFromState(
  session: CaptureSession,
  state: CaptureState,
): CaptureSession {
  if (state.captureLost) {
    return { ...session, connected: false, captureLost: true };
  }
  if (!state.connected) return EMPTY_SESSION;
  return {
    capturedTabId: state.tabId ?? session.capturedTabId,
    capturedOrigin: state.origin ?? session.capturedOrigin,
    connected: true,
    captureLost: false,
  };
}

/** Records the target of a successful handover. */
export function withTarget(
  session: CaptureSession,
  tabId: number,
  origin: string,
): CaptureSession {
  return { capturedTabId: tabId, capturedOrigin: origin, connected: true, captureLost: false };
}

export function badgeInputFor(
  session: CaptureSession,
  activeTabId: number | null,
): BadgeInput {
  return {
    connected: session.connected,
    captureLost: session.captureLost,
    capturedTabId: session.capturedTabId,
    activeTabId,
  };
}
