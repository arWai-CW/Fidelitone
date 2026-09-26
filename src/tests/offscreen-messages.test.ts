import { describe, expect, it, vi } from "vitest";
import {
  createOffscreenMessageListener,
  handleOffscreenMessage,
  type OffscreenController,
  type OffscreenMessageResponse,
} from "../offscreen/offscreen-messages";
import { TransitionQueue } from "../lib/transition-queue";
import type { CaptureState } from "../offscreen/offscreen-state";

function createState(): CaptureState {
  return {
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
    tabId: null,
    page: null,
  };
}

function controller(): OffscreenController {
  const state: CaptureState = createState();
  const queue = new TransitionQueue();
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
    switchCapture: vi.fn(async (request) => {
      state.connected = request.streamId !== null;
      state.tabId = request.tabId;
      state.page = request.page;
      if (request.settings) {
        state.pitch = request.settings.pitch;
        state.bypass = request.settings.bypass;
        state.preserveFormants = request.settings.preserveFormants;
        state.accompanimentMode = request.settings.accompanimentMode;
        state.selectedEngine = request.settings.engine;
      }
    }),
    stopCapture: async () => {
      state.connected = false;
      state.tabId = null;
      state.page = null;
    },
    getState: () => ({ ready: true, state }),
    runTransition: (operation) => queue.run(operation),
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

  it("applies an atomic handover and returns the resulting state", async () => {
    const api = controller();
    const response = await handleOffscreenMessage(
      {
        type: "SWITCH_CAPTURE",
        streamId: "stream-1",
        tabId: 42,
        page: "https://www.youtube.com",
        settings: {
          pitch: 3,
          bypass: false,
          preserveFormants: true,
          accompanimentMode: false,
          engine: "rubberband",
        },
      },
      api,
    );

    expect(response.ok).toBe(true);
    expect(response.state).toMatchObject({
      connected: true,
      pitch: 3,
      preserveFormants: true,
      tabId: 42,
      page: "https://www.youtube.com",
    });
    expect(api.switchCapture).toHaveBeenCalledWith({
      streamId: "stream-1",
      tabId: 42,
      page: "https://www.youtube.com",
      settings: {
        pitch: 3,
        bypass: false,
        preserveFormants: true,
        accompanimentMode: false,
        engine: "rubberband",
      },
    });
  });

  it("rejects a handover payload that is not well formed", async () => {
    const api = controller();
    await expect(handleOffscreenMessage({ type: "SWITCH_CAPTURE" }, api)).resolves.toEqual({
      ok: false,
      error: "Invalid switch request",
    });
    await expect(
      handleOffscreenMessage({ type: "SWITCH_CAPTURE", tabId: 1, page: "x", streamId: 7 }, api),
    ).resolves.toEqual({ ok: false, error: "Invalid switch request" });
    expect(api.switchCapture).not.toHaveBeenCalled();
  });

  it("ignores message types it does not own", () => {
    const api = controller();
    const listener = createOffscreenMessageListener(api);
    const sendResponse = vi.fn();
    expect(listener({ type: "CAPTURE_EVENT", connected: true }, null, sendResponse)).toBe(false);
    expect(listener("not an object", null, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe("message serialisation", () => {
  it("runs mutating messages one at a time while GET_STATE answers immediately", async () => {
    const order: string[] = [];
    let releasePitch!: () => void;
    const pitchGate = new Promise<void>((resolve) => {
      releasePitch = resolve;
    });
    const queue = new TransitionQueue();

    const api = controller();
    api.setPitch = vi.fn(async () => {
      order.push("pitch:start");
      await pitchGate;
      order.push("pitch:end");
      return true;
    });
    api.setBypass = vi.fn(async () => {
      order.push("bypass");
      return true;
    });
    api.runTransition = (operation) => queue.run(operation);

    const listener = createOffscreenMessageListener(api);
    const responses: OffscreenMessageResponse[] = [];
    expect(listener({ type: "SET_PITCH", value: { semitones: 1 } }, null, (r) => responses.push(r))).toBe(true);
    expect(listener({ type: "SET_BYPASS", value: { active: true } }, null, (r) => responses.push(r))).toBe(true);

    const stateResponses: OffscreenMessageResponse[] = [];
    expect(listener({ type: "GET_STATE" }, null, (r) => stateResponses.push(r))).toBe(false);
    expect(stateResponses).toHaveLength(1);
    expect(stateResponses[0].ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["pitch:start"]);
    expect(responses).toHaveLength(0);

    releasePitch();
    await vi.waitFor(() => {
      expect(responses).toHaveLength(2);
    });

    expect(order).toEqual(["pitch:start", "pitch:end", "bypass"]);
    expect(responses.every((r) => r.ok)).toBe(true);
  });

  it("keeps the queue usable after a failing transition", async () => {
    const queue = new TransitionQueue();
    await expect(
      queue.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(queue.run(async () => "still-alive")).resolves.toBe("still-alive");
  });

  it("preserves submission order across overlapping transitions", async () => {
    const queue = new TransitionQueue();
    const seen: number[] = [];
    await Promise.all(
      [3, 1, 2].map((n, index) =>
        queue.run(async () => {
          await new Promise((resolve) => setTimeout(resolve, n));
          seen.push(index);
        }),
      ),
    );
    expect(seen).toEqual([0, 1, 2]);
  });
});
