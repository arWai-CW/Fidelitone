// Pure helpers for per-page memory and tab-follow decisions.
// ADR-0004, amended: storage is sparse (only values that differ from
// PAGE_DEFAULTS), the identity of a record is the page URL (origin + path +
// query, no fragment), and capture decisions are derived from plain data so
// they can be unit tested without chrome.* APIs.

import type { ProcessingSettings } from "./audio-state";

/** Sparse per-page overrides. Absent keys mean "use PAGE_DEFAULTS". */
export interface PageSettings {
  pitch?: number;
  bypass?: boolean;
  preserveFormants?: boolean;
  accompanimentMode?: boolean;
}

/** A page record resolved against the defaults (the unit applied on switch). */
export type ResolvedPageSettings = ProcessingSettings;

/** Clean defaults applied to a page that has never been configured. */
export const PAGE_DEFAULTS: ResolvedPageSettings = {
  pitch: 0,
  bypass: false,
  preserveFormants: false,
  accompanimentMode: false,
};

/** Keys owned by a page memory record. */
export const PAGE_SETTING_KEYS = [
  "pitch",
  "bypass",
  "preserveFormants",
  "accompanimentMode",
] as const satisfies ReadonlyArray<keyof PageSettings>;

/**
 * Flat keys written before ADR-0004; removed once on upgrade. `engine` was in
 * the list until ADR-0007 dropped the choice — a record may still carry it, and
 * it is simply no longer a key anything reads.
 */
export const LEGACY_SETTING_KEYS = [
  "connected",
  "pitch",
  "bypass",
  "preserveFormants",
  "accompanimentMode",
  "engine",
] as const;

/**
 * Origin-scoped records written before memory moved to URLs: an origin key
 * cannot be mapped onto any single page, so it is dropped rather than kept as
 * a fallback that would make two videos share a pitch again.
 */
export const LEGACY_RECORD_PREFIX = "site:";

export function isLegacyRecordKey(key: string): boolean {
  return key.startsWith(LEGACY_RECORD_PREFIX);
}

/** Keys that stay global (never namespaced per page). */
export const GLOBAL_SETTING_KEYS = ["snapToInteger", "youtubeBaseVolume"] as const;

export const SNAP_TO_INTEGER_DEFAULT = true;

/** Default for the global YouTube baseline volume (ADR-0005). */
export const YOUTUBE_BASE_VOLUME_DEFAULT = 100;

/** Storage key for one page's record. */
export function pageStorageKey(page: string): string {
  return `page:${page}`;
}

function isSupportedScheme(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function parseHttpUrl(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return isSupportedScheme(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The memory identity of a page: origin + path + query, without the fragment.
 * Query matters (`watch?v=a` vs `watch?v=b`), the fragment does not — it only
 * carries in-page position and would split one video into many records.
 */
export function pageKey(url: string | null | undefined): string | null {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  parsed.hash = "";
  return parsed.toString();
}

/** True when a tab URL could be captured by tabCapture (http/https only). */
export function isSupportedTabUrl(url: string | null | undefined): boolean {
  return parseHttpUrl(url) !== null;
}

/**
 * True when the page hosts the `<video>` the YouTube content script controls.
 * The manifest injects on `https://www.youtube.com/*` only, so the popup gate
 * must match that exactly — a hostname the content script never reached would
 * leave buttons enabled with nobody listening.
 */
export function isYouTubePage(page: string | null | undefined): boolean {
  const parsed = parseHttpUrl(page);
  return parsed !== null && parsed.protocol === "https:" && parsed.hostname === "www.youtube.com";
}

/** Merges sparse stored overrides onto the clean defaults. */
export function resolvePageSettings(overrides: unknown): ResolvedPageSettings {
  const record = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, unknown>;
  const pitch = typeof record.pitch === "number" && Number.isFinite(record.pitch) ? record.pitch : PAGE_DEFAULTS.pitch;
  return {
    pitch,
    bypass: record.bypass === true,
    preserveFormants: record.preserveFormants === true,
    accompanimentMode: record.accompanimentMode === true,
  };
}

/** Drops every value that equals the default, so storage stays sparse. */
export function diffAgainstDefaults(next: ResolvedPageSettings): PageSettings {
  const sparse: PageSettings = {};
  if (next.pitch !== PAGE_DEFAULTS.pitch) sparse.pitch = next.pitch;
  if (next.bypass !== PAGE_DEFAULTS.bypass) sparse.bypass = next.bypass;
  if (next.preserveFormants !== PAGE_DEFAULTS.preserveFormants) {
    sparse.preserveFormants = next.preserveFormants;
  }
  if (next.accompanimentMode !== PAGE_DEFAULTS.accompanimentMode) {
    sparse.accompanimentMode = next.accompanimentMode;
  }
  return sparse;
}

/** Applies a single edit on top of stored overrides and re-sparsifies. */
export function writePageSetting(
  current: unknown,
  patch: Partial<ResolvedPageSettings>,
): PageSettings {
  return diffAgainstDefaults({ ...resolvePageSettings(current), ...patch });
}

/** True when a record carries no non-default value (the key can be deleted). */
export function isEmptyPageSettings(overrides: unknown): boolean {
  return Object.keys(diffAgainstDefaults(resolvePageSettings(overrides))).length === 0;
}

export type CaptureSkipReason =
  | "missing-tab"
  | "no-capture"
  | "same-tab"
  | "missing-url"
  | "unsupported-url";

export type CapturePlan =
  | { action: "switch"; tabId: number; page: string }
  | { action: "skip"; reason: CaptureSkipReason };

export interface TabActivationInput {
  /** True when a capture is already running (auto-follow never starts one). */
  hasCapture: boolean;
  capturedTabId: number | null;
  tabId: number | null | undefined;
  tabUrl: string | null | undefined;
}

/**
 * Decides whether tab activation should move the capture. Only runs after a
 * capture exists; an un-authorized or unsupported target keeps the old capture.
 */
export function planTabActivation(input: TabActivationInput): CapturePlan {
  if (input.tabId === null || input.tabId === undefined) return { action: "skip", reason: "missing-tab" };
  if (!input.hasCapture) return { action: "skip", reason: "no-capture" };
  if (input.capturedTabId === input.tabId) return { action: "skip", reason: "same-tab" };

  if (!input.tabUrl) return { action: "skip", reason: "missing-url" };
  const page = pageKey(input.tabUrl);
  if (!page) return { action: "skip", reason: "unsupported-url" };

  return { action: "switch", tabId: input.tabId, page };
}

export interface CaptureIdentity {
  tabId: number | null;
  /** Page URL the audio belongs to (see pageKey). */
  page: string | null;
}

/**
 * The captured tab and the active tab can disagree along two axes:
 * settings follow the page URL (lock), audio follows the tab (banner).
 * Two tabs on the same URL share one record, so only a different URL locks.
 */
export function isSettingsMismatch(captured: CaptureIdentity, active: CaptureIdentity): boolean {
  return captured.page !== active.page;
}

export function isCrossTabCapture(captured: CaptureIdentity, active: CaptureIdentity): boolean {
  return captured.tabId !== active.tabId;
}

export const BADGE_COLORS = {
  green: "#2ea043",
  orange: "#d29922",
  red: "#f85149",
} as const;

export interface BadgeInput {
  connected: boolean;
  captureLost: boolean;
  capturedTabId: number | null;
  activeTabId: number | null;
}

export interface BadgeState {
  text: string;
  /** null clears the badge (and its colour). */
  color: string | null;
}

/**
 * Toolbar badge: none when idle, green ON on the captured tab, orange ON· on
 * another tab, red ! when the capture was lost.
 */
export function deriveBadge(input: BadgeInput): BadgeState {
  if (input.captureLost) return { text: "!", color: BADGE_COLORS.red };
  if (!input.connected) return { text: "", color: null };
  if (input.capturedTabId !== null && input.capturedTabId === input.activeTabId) {
    return { text: "ON", color: BADGE_COLORS.green };
  }
  return { text: "ON·", color: BADGE_COLORS.orange };
}

/** Badge delta to apply (or null when nothing changed). */
export function nextBadge(
  previous: BadgeState | null,
  input: BadgeInput,
): BadgeState | null {
  const next = deriveBadge(input);
  if (previous && previous.text === next.text && previous.color === next.color) return null;
  return next;
}
