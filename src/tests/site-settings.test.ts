import { describe, expect, it } from "vitest";
import {
  BADGE_COLORS,
  DEFAULT_ENGINE,
  LEGACY_SETTING_KEYS,
  SITE_DEFAULTS,
  deriveBadge,
  diffAgainstDefaults,
  isEmptySiteSettings,
  isCrossTabCapture,
  isSettingsMismatch,
  isSupportedTabUrl,
  nextBadge,
  originKey,
  planTabActivation,
  resolveSiteSettings,
  siteStorageKey,
  writeSiteSetting,
} from "../lib/site-settings";

describe("origin identity", () => {
  it("keys memory by scheme + host + port", () => {
    expect(originKey("https://www.youtube.com/watch?v=abc")).toBe("https://www.youtube.com");
    expect(originKey("http://localhost:3000/app/index.html")).toBe("http://localhost:3000");
    expect(originKey("https://example.com:443/x")).toBe("https://example.com");
    expect(originKey("file:///etc/passwd")).toBeNull();
    expect(originKey("chrome://settings")).toBeNull();
    expect(originKey("chrome-extension://abcdef/popup.html")).toBeNull();
    expect(originKey("")).toBeNull();
    expect(originKey(null)).toBeNull();
    expect(originKey("not a url")).toBeNull();
  });

  it("rejects unsupported schemes for capture", () => {
    expect(isSupportedTabUrl("https://open.spotify.com")).toBe(true);
    expect(isSupportedTabUrl("chrome://newtab")).toBe(false);
    expect(isSupportedTabUrl(undefined)).toBe(false);
  });

  it("namespaces storage keys per origin", () => {
    expect(siteStorageKey("https://open.spotify.com")).toBe("site:https://open.spotify.com");
  });
});

describe("sparse site settings", () => {
  it("starts every new site at the clean defaults", () => {
    expect(resolveSiteSettings(undefined)).toEqual(SITE_DEFAULTS);
    expect(SITE_DEFAULTS).toEqual({
      pitch: 0,
      bypass: false,
      preserveFormants: false,
      accompanimentMode: false,
      engine: DEFAULT_ENGINE,
    });
  });

  it("ignores unknown or malformed stored values", () => {
    expect(resolveSiteSettings({ pitch: "loud", engine: "magic", bypass: 1, extra: true })).toEqual(
      SITE_DEFAULTS,
    );
  });

  it("stores only non-default values", () => {
    expect(diffAgainstDefaults({ ...SITE_DEFAULTS, pitch: 3 })).toEqual({ pitch: 3 });
    expect(diffAgainstDefaults({ ...SITE_DEFAULTS, engine: "rubberband" })).toEqual({
      engine: "rubberband",
    });
    expect(diffAgainstDefaults({ ...SITE_DEFAULTS, bypass: true, preserveFormants: true })).toEqual({
      bypass: true,
      preserveFormants: true,
    });
  });

  it("returns an empty record when everything is default", () => {
    expect(diffAgainstDefaults(SITE_DEFAULTS)).toEqual({});
    expect(isEmptySiteSettings(SITE_DEFAULTS)).toBe(true);
    expect(isEmptySiteSettings({ pitch: 2 })).toBe(false);
  });

  it("re-sparsifies after an edit so returning to default deletes the key", () => {
    expect(writeSiteSetting({ pitch: 3 }, { pitch: 4 })).toEqual({ pitch: 4 });
    expect(writeSiteSetting({ pitch: 3 }, { pitch: 0 })).toEqual({});
    expect(writeSiteSetting({ engine: "rubberband" }, { engine: "signalsmith" })).toEqual({});
    expect(writeSiteSetting(undefined, { pitch: -2, bypass: true })).toEqual({
      pitch: -2,
      bypass: true,
    });
  });

  it("keeps legacy cleanup scoped to flat keys", () => {
    expect([...LEGACY_SETTING_KEYS]).toEqual([
      "connected",
      "pitch",
      "bypass",
      "preserveFormants",
      "accompanimentMode",
      "engine",
    ]);
    expect(LEGACY_SETTING_KEYS).not.toContain("snapToInteger");
  });
});

describe("planTabActivation", () => {
  const captured = 7;

  it("never starts a capture on its own", () => {
    expect(
      planTabActivation({ hasCapture: false, capturedTabId: null, tabId: 3, tabUrl: "https://a.com" }),
    ).toEqual({ action: "skip", reason: "no-capture" });
  });

  it("skips when the active tab is already the captured one", () => {
    expect(
      planTabActivation({ hasCapture: true, capturedTabId: captured, tabId: captured, tabUrl: "https://a.com" }),
    ).toEqual({ action: "skip", reason: "same-tab" });
  });

  it("keeps the current capture on unsupported or missing targets", () => {
    expect(
      planTabActivation({ hasCapture: true, capturedTabId: captured, tabId: 9, tabUrl: "chrome://extensions" }),
    ).toEqual({ action: "skip", reason: "unsupported-origin" });
    expect(
      planTabActivation({ hasCapture: true, capturedTabId: captured, tabId: 9, tabUrl: undefined }),
    ).toEqual({ action: "skip", reason: "missing-url" });
    expect(
      planTabActivation({ hasCapture: true, capturedTabId: captured, tabId: null, tabUrl: "https://a.com" }),
    ).toEqual({ action: "skip", reason: "missing-tab" });
  });

  it("switches to an eligible tab and reports its origin", () => {
    expect(
      planTabActivation({
        hasCapture: true,
        capturedTabId: captured,
        tabId: 9,
        tabUrl: "https://music.example.com/library?x=1",
      }),
    ).toEqual({ action: "switch", tabId: 9, origin: "https://music.example.com" });
  });
});

describe("divergence", () => {
  it("locks on origin mismatch only", () => {
    const captured = { tabId: 1, origin: "https://a.com" };
    expect(isSettingsMismatch(captured, { tabId: 2, origin: "https://a.com" })).toBe(false);
    expect(isCrossTabCapture(captured, { tabId: 2, origin: "https://a.com" })).toBe(true);

    expect(isSettingsMismatch(captured, { tabId: 1, origin: "https://b.com" })).toBe(true);
    expect(isCrossTabCapture(captured, { tabId: 1, origin: "https://b.com" })).toBe(false);
  });

  it("treats an unknown captured origin as a mismatch", () => {
    expect(isSettingsMismatch({ tabId: 1, origin: null }, { tabId: 1, origin: "https://a.com" })).toBe(true);
  });
});

describe("deriveBadge", () => {
  it("has four states", () => {
    const base = { connected: false, captureLost: false, capturedTabId: 1, activeTabId: 1 };
    expect(deriveBadge(base)).toEqual({ text: "", color: null });

    expect(deriveBadge({ ...base, connected: true })).toEqual({
      text: "ON",
      color: BADGE_COLORS.green,
    });

    expect(
      deriveBadge({ ...base, connected: true, activeTabId: 2 }),
    ).toEqual({ text: "ON·", color: BADGE_COLORS.orange });

    expect(
      deriveBadge({ ...base, connected: false, captureLost: true, activeTabId: 2 }),
    ).toEqual({ text: "!", color: BADGE_COLORS.red });
  });

  it("emits an update only when the badge actually changes", () => {
    const input = { connected: true, captureLost: false, capturedTabId: 1, activeTabId: 1 };
    const first = deriveBadge(input);
    expect(nextBadge(first, input)).toBeNull();
    expect(nextBadge(first, { ...input, activeTabId: 5 })).toEqual({
      text: "ON·",
      color: BADGE_COLORS.orange,
    });
    expect(nextBadge(null, input)).toEqual(first);
  });
});
