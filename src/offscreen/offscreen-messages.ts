import type { CaptureState, Engine, SwitchCaptureRequest } from "./offscreen-state";
import { resolveSiteSettings } from "../lib/site-settings";

export interface OffscreenController {
  setPitch(value: { semitones: number }): Promise<boolean>;
  setBypass(value: { active: boolean }): Promise<boolean>;
  setFormants(value: { preserve: boolean }): Promise<boolean>;
  setAccompaniment(value: { enabled: boolean }): Promise<boolean>;
  setEngine(engine: Engine): Promise<boolean>;
  switchCapture(request: SwitchCaptureRequest): Promise<void>;
  stopCapture(): Promise<void>;
  getState(): { ready: boolean; state: CaptureState };
  /** Serialises this message behind any transition already in flight. */
  runTransition<T>(operation: () => Promise<T>): Promise<T>;
}

export interface OffscreenMessageResponse {
  ok: boolean;
  ready?: boolean;
  state?: CaptureState;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** ADR-0004: handovers are atomic, so only a well-formed payload is accepted. */
function readSwitchCaptureRequest(msg: Record<string, unknown>): SwitchCaptureRequest | null {
  const { tabId, origin, streamId, settings } = msg;
  if (typeof tabId !== "number" || !Number.isInteger(tabId)) return null;
  if (typeof origin !== "string" || origin.length === 0) return null;
  if (streamId !== null && streamId !== undefined && typeof streamId !== "string") return null;
  if (settings !== null && settings !== undefined && typeof settings !== "object") return null;

  return {
    tabId,
    origin,
    streamId: typeof streamId === "string" ? streamId : null,
    settings:
      settings === null || settings === undefined ? null : resolveSiteSettings(settings),
  };
}

export async function handleOffscreenMessage(
  message: unknown,
  controller: OffscreenController,
): Promise<OffscreenMessageResponse> {
  if (!message || typeof message !== "object") return { ok: false, error: "Invalid message" };
  const msg = message as Record<string, unknown>;

  try {
    switch (msg.type) {
      case "SET_PITCH":
        return { ok: await controller.setPitch(msg.value as { semitones: number }) };
      case "SET_BYPASS":
        return { ok: await controller.setBypass(msg.value as { active: boolean }) };
      case "SET_FORMANTS":
        return { ok: await controller.setFormants(msg.value as { preserve: boolean }) };
      case "SET_ENGINE":
        return { ok: await controller.setEngine(msg.engine as Engine) };
      case "SET_ACCOMPANIMENT":
        return { ok: await controller.setAccompaniment(msg.value as { enabled: boolean }) };
      case "SWITCH_CAPTURE": {
        const request = readSwitchCaptureRequest(msg);
        if (!request) return { ok: false, error: "Invalid switch request" };
        await controller.switchCapture(request);
        const snapshot = controller.getState();
        return { ok: true, ready: snapshot.ready, state: snapshot.state };
      }
      case "STOP_CAPTURE":
        await controller.stopCapture();
        return { ok: true };
      case "GET_STATE": {
        const state = controller.getState();
        return { ok: true, ready: state.ready, state: state.state };
      }
      default:
        return { ok: false, error: "Unknown message" };
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export const MESSAGE_TYPES = new Set([
  "SET_PITCH",
  "SET_BYPASS",
  "SET_FORMANTS",
  "SET_ENGINE",
  "SET_ACCOMPANIMENT",
  "SWITCH_CAPTURE",
  "STOP_CAPTURE",
  "GET_STATE",
]);

export type OffscreenMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: OffscreenMessageResponse) => void,
) => boolean;

/**
 * Every mutating message runs through the controller's transition queue, so the
 * service worker's handover and the popup's edits can never interleave.
 * GET_STATE stays outside: a reconcile must answer immediately.
 */
export function createOffscreenMessageListener(
  controller: OffscreenController,
): OffscreenMessageListener {
  return (message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const msg = message as Record<string, unknown>;
    const type = msg.type;
    if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) return false;

    if (type === "GET_STATE") {
      const snapshot = controller.getState();
      sendResponse({ ok: true, ready: snapshot.ready, state: snapshot.state });
      return false;
    }

    controller
      .runTransition(() => handleOffscreenMessage(message, controller))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  };
}

export function registerOffscreenMessages(controller: OffscreenController): void {
  chrome.runtime.onMessage.addListener(createOffscreenMessageListener(controller));
}
