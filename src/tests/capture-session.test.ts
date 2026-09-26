import { describe, expect, it } from "vitest";
import {
  EMPTY_SESSION,
  badgeInputFor,
  hasActiveCapture,
  sessionFromEvent,
  sessionFromState,
  withTarget,
} from "../background/capture-session";
import { BADGE_COLORS, deriveBadge } from "../lib/page-settings";
import type { CaptureState } from "../lib/audio-state";

function state(overrides: Partial<CaptureState> = {}): CaptureState {
  return {
    connected: true,
    pitch: 0,
    bypass: false,
    preserveFormants: false,
    accompanimentMode: false,
    tabId: 5,
    page: "https://www.youtube.com",
    ...overrides,
  };
}

describe("capture session mirror", () => {
  it("starts empty with no capture to follow", () => {
    expect(hasActiveCapture(EMPTY_SESSION)).toBe(false);
    expect(badgeInputFor(EMPTY_SESSION, 1)).toEqual({
      connected: false,
      captureLost: false,
      capturedTabId: null,
      activeTabId: 1,
    });
  });

  it("applies capture events in order", () => {
    const started = sessionFromEvent({
      connected: true,
      captureLost: false,
      tabId: 5,
      page: "https://www.youtube.com",
    });
    expect(hasActiveCapture(started)).toBe(true);

    const lost = sessionFromEvent({
      connected: false,
      captureLost: true,
      tabId: 5,
      page: "https://www.youtube.com",
    });
    expect(hasActiveCapture(lost)).toBe(false);
    expect(lost.capturedTabId).toBe(5);

    const stopped = sessionFromEvent({
      connected: false,
      captureLost: false,
      tabId: null,
      page: null,
    });
    expect(stopped).toEqual(EMPTY_SESSION);
  });

  it("trusts the offscreen snapshot when reconciling", () => {
    const stale = withTarget(EMPTY_SESSION, 1, "https://a.com");

    expect(sessionFromState(stale, state({ tabId: 9, page: "https://b.com" }))).toEqual({
      capturedTabId: 9,
      capturedPage: "https://b.com",
      connected: true,
      captureLost: false,
    });

    expect(sessionFromState(stale, state({ connected: false }))).toEqual(EMPTY_SESSION);

    const lost = sessionFromState(stale, state({ connected: false, captureLost: true }));
    expect(lost).toMatchObject({ connected: false, captureLost: true, capturedTabId: 1 });
    expect(hasActiveCapture(lost)).toBe(false);
  });

  it("keeps the last identity when the snapshot omits it", () => {
    const stale = withTarget(EMPTY_SESSION, 4, "https://a.com");
    const next = sessionFromState(stale, state({ tabId: undefined, page: undefined }));
    expect(next.capturedTabId).toBe(4);
    expect(next.capturedPage).toBe("https://a.com");
  });

  it("drives the four badge states from the mirror", () => {
    const capturing = withTarget(EMPTY_SESSION, 5, "https://a.com");
    expect(deriveBadge(badgeInputFor(capturing, 5))).toEqual({
      text: "ON",
      color: BADGE_COLORS.green,
    });
    expect(deriveBadge(badgeInputFor(capturing, 8))).toEqual({
      text: "ON·",
      color: BADGE_COLORS.orange,
    });

    const lost = sessionFromEvent({
      connected: false,
      captureLost: true,
      tabId: 5,
      page: "https://a.com",
    });
    expect(deriveBadge(badgeInputFor(lost, 8))).toEqual({ text: "!", color: BADGE_COLORS.red });
    expect(deriveBadge(badgeInputFor(EMPTY_SESSION, 8))).toEqual({ text: "", color: null });
  });
});
