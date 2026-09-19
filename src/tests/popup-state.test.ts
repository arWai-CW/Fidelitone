import { describe, expect, it } from "vitest";
import {
  applyCaptureState,
  clampPitch,
  connectionState,
  createPopupState,
  formatSemitones,
  isProcessingLocked,
  selectEngine,
  setBypass,
  setConnected,
  setConnecting,
} from "../popup/popup-state";

describe("popup state", () => {
  it("derives connection and lock state", () => {
    let state = createPopupState();
    expect(connectionState(state)).toBe("disconnected");
    expect(isProcessingLocked(state)).toBe(true);

    state = setConnecting(state, true);
    expect(connectionState(state)).toBe("connecting");
    expect(isProcessingLocked(state)).toBe(true);

    state = setConnecting(state, false);
    state = setConnected(state, true);
    expect(connectionState(state)).toBe("connected");
    expect(isProcessingLocked(state)).toBe(false);
  });

  it("applies live capture state without losing the selected engine fallback", () => {
    const state = applyCaptureState(
      selectEngine(createPopupState(), "signalsmith"),
      {
        connected: true,
        pitch: 3,
        bypass: true,
        preserveFormants: true,
        accompanimentMode: false,
        engine: "rubberband",
        selectedEngine: "signalsmith",
        route: "bypass",
      },
    );

    expect(state.selectedEngine).toBe("signalsmith");
    expect(state.bypass).toBe(true);
    expect(state.route).toBe("bypass");
    expect(state.engineAvailability).toEqual({
      signalsmith: true,
      rubberband: false,
    });
  });

  it("keeps pitch math at the UI contract", () => {
    expect(clampPitch(20)).toBe(12);
    expect(clampPitch(-20)).toBe(-12);
    expect(formatSemitones(0)).toBe("+0.00");
    expect(formatSemitones(-7)).toBe("-7.00");
  });

  it("rolls back bypass and engine selection through pure transitions", () => {
    const connected = setConnected(createPopupState(), true);
    expect(setBypass(connected, true).bypass).toBe(true);
    expect(selectEngine(connected, "signalsmith").selectedEngine).toBe("signalsmith");
  });
});
