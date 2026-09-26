import { describe, expect, it } from "vitest";
import {
  applyCaptureState,
  clampPitch,
  connectionState,
  createPopupState,
  formatSemitones,
  isProcessingLocked,
  isSettingsLocked,
  selectEngine,
  setActiveTab,
  setBypass,
  setCaptureIdentity,
  setConnected,
  setConnecting,
  showDivergenceBanner,
  type CaptureState,
} from "../popup/popup-state";

function capture(patch: Partial<CaptureState>): CaptureState {
  return {
    connected: true,
    pitch: 0,
    bypass: false,
    preserveFormants: false,
    accompanimentMode: false,
    ...patch,
  };
}

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
      capture({
        pitch: 3,
        bypass: true,
        preserveFormants: true,
        engine: "rubberband",
        selectedEngine: "signalsmith",
        route: "bypass",
      }),
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

  it("defaults the selected engine to Signalsmith", () => {
    expect(createPopupState().selectedEngine).toBe("signalsmith");
  });

  it("locks controls only when the active tab sits on another origin", () => {
    const base = setConnected(
      setActiveTab(createPopupState(), { id: 1, origin: "https://a.com" }),
      true,
    );
    const capturing = applyCaptureState(base, capture({ tabId: 1, origin: "https://a.com" }));
    expect(isSettingsLocked(capturing)).toBe(false);
    expect(isProcessingLocked(capturing)).toBe(false);

    const sameOriginOtherTab = applyCaptureState(
      capturing,
      capture({ tabId: 7, origin: "https://a.com" }),
    );
    expect(isSettingsLocked(sameOriginOtherTab)).toBe(false);
    expect(isProcessingLocked(sameOriginOtherTab)).toBe(false);

    const otherOrigin = applyCaptureState(capturing, capture({ tabId: 1, origin: "https://b.com" }));
    expect(isSettingsLocked(otherOrigin)).toBe(true);
    expect(isProcessingLocked(otherOrigin)).toBe(true);
  });

  it("shows the divergence banner only while the audio is elsewhere", () => {
    const base = setConnected(
      setActiveTab(createPopupState(), { id: 1, origin: "https://a.com" }),
      true,
    );
    const elsewhere = applyCaptureState(base, capture({ tabId: 7, origin: "https://a.com" }));
    expect(showDivergenceBanner(elsewhere)).toBe(true);

    const sameTab = applyCaptureState(base, capture({ tabId: 1, origin: "https://a.com" }));
    expect(showDivergenceBanner(sameTab)).toBe(false);

    expect(showDivergenceBanner(setConnected(elsewhere, false))).toBe(false);
  });

  it("forgets the captured identity when the capture stops", () => {
    const base = setConnected(
      setActiveTab(createPopupState(), { id: 1, origin: "https://a.com" }),
      true,
    );
    const state = applyCaptureState(base, capture({ tabId: 3, origin: "https://a.com" }));
    expect(state.capturedTabId).toBe(3);
    expect(state.capturedOrigin).toBe("https://a.com");

    const stopped = setConnected(state, false);
    expect(stopped.capturedTabId).toBeNull();
    expect(stopped.capturedOrigin).toBeNull();
  });

  it("tracks the active tab independently of the capture", () => {
    const state = setActiveTab(createPopupState(), { id: 42, origin: "https://b.com" });
    expect(state.activeTabId).toBe(42);
    expect(state.activeOrigin).toBe("https://b.com");
    expect(setActiveTab(state, { id: 43, origin: null }).activeOrigin).toBeNull();
  });

  it("records the capture identity even when GET_STATE is unavailable", () => {
    const state = setCaptureIdentity(createPopupState(), {
      id: 9,
      origin: "https://www.youtube.com",
    });
    expect(state.capturedTabId).toBe(9);
    expect(state.capturedOrigin).toBe("https://www.youtube.com");
    expect(setCaptureIdentity(state, { id: null, origin: null }).capturedTabId).toBeNull();
  });
});
