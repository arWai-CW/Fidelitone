// Pure helpers for per-origin site memory and tab-follow decisions.
// ADR-0004: storage is sparse (only values that differ from SITE_DEFAULTS),
// the identity of a site is its origin, and capture decisions are derived
// from plain data so they can be unit tested without chrome.* APIs.

import type { Engine, ProcessingSettings } from "./audio-state";

/** Sparse per-origin overrides. Absent keys mean "use SITE_DEFAULTS". */
export interface SiteSettings {
  pitch?: number;
  bypass?: boolean;
  preserveFormants?: boolean;
  accompanimentMode?: boolean;
  engine?: Engine;
}

/** A site record resolved against the defaults (the unit applied on switch). */
export type ResolvedSiteSettings = ProcessingSettings;

export const DEFAULT_ENGINE: Engine = "signalsmith";

/** Clean defaults applied to a site that has never been configured. */
export const SITE_DEFAULTS: ResolvedSiteSettings = {
  pitch: 0,
  bypass: false,
  preserveFormants: false,
  accompanimentMode: false,
  engine: DEFAULT_ENGINE,
};

/** Keys owned by a site memory record. */
export const SITE_SETTING_KEYS = [
  "pitch",
  "bypass",
  "preserveFormants",
  "accompanimentMode",
  "engine",
] as const satisfies ReadonlyArray<keyof SiteSettings>;

/** Flat keys written before ADR-0004; removed once on upgrade. */
export const LEGACY_SETTING_KEYS = [
  "connected",
  "pitch",
  "bypass",
  "preserveFormants",
  "accompanimentMode",
  "engine",
] as const;

/** Keys that stay global (never namespaced per origin). */
export const GLOBAL_SETTING_KEYS = ["snapToInteger"] as const;

export const SNAP_TO_INTEGER_DEFAULT = true;

export function siteStorageKey(origin: string): string {
  return `site:${origin}`;
}

function isSupportedScheme(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

/** Derives an origin (scheme + host + port) from a tab URL, or null. */
export function originKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return isSupportedScheme(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** True when a tab URL could be captured by tabCapture (http/https only). */
export function isSupportedTabUrl(url: string | null | undefined): boolean {
  return originKey(url) !== null;
}

function isEngine(value: unknown): value is Engine {
  return value === "rubberband" || value === "signalsmith";
}

/** Merges sparse stored overrides onto the clean defaults. */
export function resolveSiteSettings(overrides: unknown): ResolvedSiteSettings {
  const record = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, unknown>;
  const pitch = typeof record.pitch === "number" && Number.isFinite(record.pitch) ? record.pitch : SITE_DEFAULTS.pitch;
  return {
    pitch,
    bypass: record.bypass === true,
    preserveFormants: record.preserveFormants === true,
    accompanimentMode: record.accompanimentMode === true,
    engine: isEngine(record.engine) ? record.engine : SITE_DEFAULTS.engine,
  };
}

/** Drops every value that equals the default, so storage stays sparse. */
export function diffAgainstDefaults(next: ResolvedSiteSettings): SiteSettings {
  const sparse: SiteSettings = {};
  if (next.pitch !== SITE_DEFAULTS.pitch) sparse.pitch = next.pitch;
  if (next.bypass !== SITE_DEFAULTS.bypass) sparse.bypass = next.bypass;
  if (next.preserveFormants !== SITE_DEFAULTS.preserveFormants) {
    sparse.preserveFormants = next.preserveFormants;
  }
  if (next.accompanimentMode !== SITE_DEFAULTS.accompanimentMode) {
    sparse.accompanimentMode = next.accompanimentMode;
  }
  if (next.engine !== SITE_DEFAULTS.engine) sparse.engine = next.engine;
  return sparse;
}

/** Applies a single edit on top of stored overrides and re-sparsifies. */
export function writeSiteSetting(
  current: unknown,
  patch: Partial<ResolvedSiteSettings>,
): SiteSettings {
  return diffAgainstDefaults({ ...resolveSiteSettings(current), ...patch });
}

/** True when a record carries no non-default value (the key can be deleted). */
export function isEmptySiteSettings(overrides: unknown): boolean {
  return Object.keys(diffAgainstDefaults(resolveSiteSettings(overrides))).length === 0;
}

export type CaptureSkipReason =
  | "missing-tab"
  | "no-capture"
  | "same-tab"
  | "missing-url"
  | "unsupported-origin";

export type CapturePlan =
  | { action: "switch"; tabId: number; origin: string }
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

  const origin = originKey(input.tabUrl);
  if (!input.tabUrl) return { action: "skip", reason: "missing-url" };
  if (!origin) return { action: "skip", reason: "unsupported-origin" };

  return { action: "switch", tabId: input.tabId, origin };
}

export interface CaptureIdentity {
  tabId: number | null;
  origin: string | null;
}

/**
 * The captured tab and the active tab can disagree along two axes:
 * settings follow origin (lock), audio follows tab (banner).
 */
export function isSettingsMismatch(captured: CaptureIdentity, active: CaptureIdentity): boolean {
  return captured.origin !== active.origin;
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
