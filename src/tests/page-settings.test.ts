import { describe, expect, it } from "vitest";
import {
  BADGE_COLORS,
  DEFAULT_ENGINE,
  LEGACY_RECORD_PREFIX,
  LEGACY_SETTING_KEYS,
  PAGE_DEFAULTS,
  deriveBadge,
  diffAgainstDefaults,
  isEmptyPageSettings,
  isCrossTabCapture,
  isLegacyRecordKey,
  isSettingsMismatch,
  isSupportedTabUrl,
  nextBadge,
  pageKey,
  planTabActivation,
  resolvePageSettings,
  pageStorageKey,
  writePageSetting,
} from "../lib/page-settings";

describe("page identity", () => {
  it("keys memory by the page URL, not the site", () => {
    const videoA = pageKey("https://www.youtube.com/watch?v=abc");
    const videoB = pageKey("https://www.youtube.com/watch?v=def");
    expect(videoA).toBe("https://www.youtube.com/watch?v=abc");
    expect(videoB).toBe("https://www.youtube.com/watch?v=def");
    expect(videoA).not.toBe(videoB);
    expect(pageKey("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")).toBe(
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    );
  });

  it("drops the fragment, which only records in-page position", () => {
    expect(pageKey("https://www.youtube.com/watch?v=abc&t=42s")).toBe(
      "https://www.youtube.com/watch?v=abc&t=42s",
    );
    expect(pageKey("https://www.youtube.com/watch?v=abc#t=42")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
    expect(pageKey("https://open.spotify.com/search/miles#details")).toBe(
      "https://open.spotify.com/search/miles",
    );
  });

  it("normalises the URL the way the storage key needs", () => {
    expect(pageKey("https://Example.COM:443/x")).toBe("https://example.com/x");
    expect(pageKey("https://www.youtube.com")).toBe("https://www.youtube.com/");
    expect(pageKey("http://localhost:3000/app/index.html")).toBe(
      "http://localhost:3000/app/index.html",
    );
  });

  it("rejects URLs that cannot be captured", () => {
    expect(pageKey("file:///etc/passwd")).toBeNull();
    expect(pageKey("chrome://settings")).toBeNull();
    expect(pageKey("chrome-extension://abcdef/popup.html")).toBeNull();
    expect(pageKey("")).toBeNull();
    expect(pageKey(null)).toBeNull();
    expect(pageKey("not a url")).toBeNull();
    expect(isSupportedTabUrl("https://open.spotify.com")).toBe(true);
    expect(isSupportedTabUrl("chrome://newtab")).toBe(false);
    expect(isSupportedTabUrl(undefined)).toBe(false);
  });

  it("namespaces storage keys per page", () => {
    expect(pageStorageKey("https://open.spotify.com/track/abc")).toBe(
      "page:https://open.spotify.com/track/abc",
    );
  });

  it("recognises origin-scoped records as legacy", () => {
    expect(LEGACY_RECORD_PREFIX).toBe("site:");
    expect(isLegacyRecordKey("site:https://www.youtube.com")).toBe(true);
    expect(isLegacyRecordKey("page:https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isLegacyRecordKey("snapToInteger")).toBe(false);
  });

  it("keeps two videos on one site in separate records", () => {
    const store: Record<string, unknown> = {};
    const videoA = pageKey("https://www.youtube.com/watch?v=abc");
    const videoB = pageKey("https://www.youtube.com/watch?v=def");
    expect(videoA).not.toBeNull();
    expect(videoB).not.toBeNull();

    store[pageStorageKey(videoA!)] = writePageSetting(undefined, { pitch: 3 });

    expect(resolvePageSettings(store[pageStorageKey(videoA!)]).pitch).toBe(3);
    expect(resolvePageSettings(store[pageStorageKey(videoB!)]).pitch).toBe(PAGE_DEFAULTS.pitch);
  });
});

describe("sparse page settings", () => {
  it("starts every new page at the clean defaults", () => {
    expect(resolvePageSettings(undefined)).toEqual(PAGE_DEFAULTS);
    expect(PAGE_DEFAULTS).toEqual({
      pitch: 0,
      bypass: false,
      preserveFormants: false,
      accompanimentMode: false,
      engine: DEFAULT_ENGINE,
    });
  });

  it("ignores unknown or malformed stored values", () => {
    expect(resolvePageSettings({ pitch: "loud", engine: "magic", bypass: 1, extra: true })).toEqual(
      PAGE_DEFAULTS,
    );
  });

  it("stores only non-default values", () => {
    expect(diffAgainstDefaults({ ...PAGE_DEFAULTS, pitch: 3 })).toEqual({ pitch: 3 });
    expect(diffAgainstDefaults({ ...PAGE_DEFAULTS, engine: "rubberband" })).toEqual({
      engine: "rubberband",
    });
    expect(diffAgainstDefaults({ ...PAGE_DEFAULTS, bypass: true, preserveFormants: true })).toEqual({
      bypass: true,
      preserveFormants: true,
    });
  });

  it("returns an empty record when everything is default", () => {
    expect(diffAgainstDefaults(PAGE_DEFAULTS)).toEqual({});
    expect(isEmptyPageSettings(PAGE_DEFAULTS)).toBe(true);
    expect(isEmptyPageSettings({ pitch: 2 })).toBe(false);
  });

  it("re-sparsifies after an edit so returning to default deletes the key", () => {
    expect(writePageSetting({ pitch: 3 }, { pitch: 4 })).toEqual({ pitch: 4 });
    expect(writePageSetting({ pitch: 3 }, { pitch: 0 })).toEqual({});
    expect(writePageSetting({ engine: "rubberband" }, { engine: "signalsmith" })).toEqual({});
    expect(writePageSetting(undefined, { pitch: -2, bypass: true })).toEqual({
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
    ).toEqual({ action: "skip", reason: "unsupported-url" });
    expect(
      planTabActivation({ hasCapture: true, capturedTabId: captured, tabId: 9, tabUrl: undefined }),
    ).toEqual({ action: "skip", reason: "missing-url" });
    expect(
      planTabActivation({ hasCapture: true, capturedTabId: captured, tabId: null, tabUrl: "https://a.com" }),
    ).toEqual({ action: "skip", reason: "missing-tab" });
  });

  it("switches to an eligible tab and reports its page URL", () => {
    expect(
      planTabActivation({
        hasCapture: true,
        capturedTabId: captured,
        tabId: 9,
        tabUrl: "https://music.example.com/library?x=1",
      }),
    ).toEqual({ action: "switch", tabId: 9, page: "https://music.example.com/library?x=1" });
  });
});

describe("divergence", () => {
  const captured = { tabId: 1, page: "https://www.youtube.com/watch?v=abc" };

  it("locks on page mismatch only", () => {
    expect(isSettingsMismatch(captured, { tabId: 2, page: captured.page })).toBe(false);
    expect(isCrossTabCapture(captured, { tabId: 2, page: captured.page })).toBe(true);

    expect(isSettingsMismatch(captured, { tabId: 1, page: "https://www.youtube.com/watch?v=def" })).toBe(true);
    expect(isCrossTabCapture(captured, { tabId: 1, page: "https://www.youtube.com/watch?v=def" })).toBe(false);
  });

  it("locks on another site, which is just another page URL", () => {
    expect(isSettingsMismatch(captured, { tabId: 1, page: "https://open.spotify.com/track/xyz" })).toBe(true);
  });

  it("treats an unknown captured page as a mismatch", () => {
    expect(isSettingsMismatch({ tabId: 1, page: null }, { tabId: 1, page: "https://a.com/x" })).toBe(true);
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
