import { describe, expect, it, vi } from "vitest";
import {
  handleOffscreenMessage,
  type OffscreenController,
} from "../offscreen/offscreen-messages";
import type { CaptureState } from "../offscreen/offscreen-state";

function controller(): OffscreenController {
  const state: CaptureState = {
    ready: true,
    connected: true,
    pitch: 0,
    bypass: false,
    preserveFormants: false,
    accompanimentMode: false,
    engine: "rubberband",
    selectedEngine: "rubberband",
    route: "rubberband",
    captureLost: false,
    engineAvailability: { signalsmith: false, rubberband: true },
  };
  return {
    setPitch: vi.fn(async (value) => {
      state.pitch = value.semitones;
      return true;
    }),
    setBypass: async (value) => {
      state.bypass = value.active;
      return true;
    },
    setFormants: async () => true,
    setAccompaniment: async () => true,
    setEngine: async () => true,
    startCapture: async () => undefined,
    stopCapture: async () => undefined,
    getState: () => ({ ready: true, state }),
  };
}

describe("offscreen message module", () => {
  it("dispatches pitch and returns the controller result", async () => {
    const api = controller();
    await expect(
      handleOffscreenMessage({ type: "SET_PITCH", value: { semitones: 3 } }, api),
    ).resolves.toEqual({ ok: true });
    expect(api.getState().state.pitch).toBe(3);
  });

  it("reports invalid and unknown messages without throwing", async () => {
    const api = controller();
    await expect(handleOffscreenMessage(null, api)).resolves.toEqual({
      ok: false,
      error: "Invalid message",
    });
    await expect(handleOffscreenMessage({ type: "UNKNOWN" }, api)).resolves.toEqual({
      ok: false,
      error: "Unknown message",
    });
  });

  it("reads state through the controller interface", async () => {
    const api = controller();
    await expect(handleOffscreenMessage({ type: "GET_STATE" }, api)).resolves.toEqual({
      ok: true,
      ready: true,
      state: api.getState().state,
    });
  });
});
