import type { CaptureState, Engine } from "./offscreen-state";

export interface OffscreenController {
  setPitch(value: { semitones: number }): Promise<boolean>;
  setBypass(value: { active: boolean }): Promise<boolean>;
  setFormants(value: { preserve: boolean }): Promise<boolean>;
  setAccompaniment(value: { enabled: boolean }): Promise<boolean>;
  setEngine(engine: Engine): Promise<boolean>;
  startCapture(streamId: string): Promise<void>;
  stopCapture(): Promise<void>;
  getState(): { ready: boolean; state: CaptureState };
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
      case "START_CAPTURE":
        await controller.startCapture(msg.streamId as string);
        return { ok: true };
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

const MESSAGE_TYPES = new Set([
  "SET_PITCH",
  "SET_BYPASS",
  "SET_FORMANTS",
  "SET_ENGINE",
  "SET_ACCOMPANIMENT",
  "START_CAPTURE",
  "STOP_CAPTURE",
  "GET_STATE",
]);

export function registerOffscreenMessages(controller: OffscreenController): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const msg = message as Record<string, unknown>;
    if (!MESSAGE_TYPES.has(String(msg.type))) return false;
    if (msg.type === "GET_STATE") {
      const state = controller.getState();
      sendResponse({ ok: true, ready: state.ready, state: state.state });
      return false;
    }

    void handleOffscreenMessage(message, controller)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  });
}
