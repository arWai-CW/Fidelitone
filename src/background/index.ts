// Background service worker — the single writer for capture lifecycle (ADR-0004).
// It watches tab activation/navigation, keeps the toolbar badge honest, and owns
// every SWITCH_CAPTURE: the popup only asks for a capture, never starts one.

import {
  LEGACY_SETTING_KEYS,
  nextBadge,
  originKey,
  planTabActivation,
  resolveSiteSettings,
  siteStorageKey,
  type BadgeState,
  type ResolvedSiteSettings,
} from "../lib/site-settings";
import { TransitionQueue } from "../lib/transition-queue";
import type { CaptureState } from "../lib/audio-state";
import {
  EMPTY_SESSION,
  badgeInputFor,
  hasActiveCapture,
  sessionFromEvent,
  sessionFromState,
  withTarget,
  type CaptureSession,
} from "./capture-session";

interface RuntimeResponse {
  ok?: boolean;
  error?: string;
  state?: CaptureState;
}

const FOLLOW_DEBOUNCE_MS = 400;
const STATE_TIMEOUT_MS = 4000;
const HANDOVER_TIMEOUT_MS = 30000;
const SESSION_STORAGE_KEY = "captureSession";

let session: CaptureSession = EMPTY_SESSION;
let activeTabId: number | null = null;
let badge: BadgeState | null = null;
let pendingFollow: number | null = null;
let followTimer: ReturnType<typeof setTimeout> | null = null;
/** One capture mutation at a time: follows, popup requests and releases. */
const captureQueue = new TransitionQueue();

/* ---------------------------------------------------------------- chrome glue */

function storageGet<T>(keys: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (data) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(data as T);
    });
  });
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function sessionGet<T>(keys: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(keys, (data) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(data as T);
    });
  });
}

function sessionSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(values, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function getMediaStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else if (!streamId) reject(new Error("No media stream id was issued"));
      else resolve(streamId);
    });
  });
}

function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      void chrome.runtime.lastError;
      resolve(tab ?? null);
    });
  });
}

function activeTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void chrome.runtime.lastError;
      resolve(tabs[0] ?? null);
    });
  });
}

/** Sends a message to the offscreen document and drains lastError. */
function sendToOffscreen(message: Record<string, unknown>, timeoutMs: number): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: RuntimeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "Offscreen document did not respond" }), timeoutMs);
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) finish({ ok: false, error: err.message });
        else finish((response ?? { ok: false, error: "No response from offscreen document" }) as RuntimeResponse);
      });
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA" as chrome.offscreen.Reason, "AUDIO_PLAYBACK" as chrome.offscreen.Reason],
      justification: "Tab audio capture and processed AudioWorklet playback",
    });
  } catch (err) {
    // The popup may be creating it at the same time; only rethrow if nobody did.
    const again = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (again.length === 0) throw err;
  }
}

async function getOffscreenState(): Promise<CaptureState | null> {
  const response = await sendToOffscreen({ type: "GET_STATE" }, STATE_TIMEOUT_MS);
  if (response?.ok && response.state) return response.state;
  return null;
}

async function readSiteSettings(origin: string): Promise<ResolvedSiteSettings> {
  const key = siteStorageKey(origin);
  const data = await storageGet<Record<string, unknown>>([key]);
  return resolveSiteSettings(data[key]);
}

async function setBadgeText(text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.action.setBadgeText({ text }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function setBadgeColor(color: string): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.action.setBadgeBackgroundColor({ color }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/**
 * Badge writes are chained: a handover and a tab activation can race, and two
 * interleaved color/text pairs would leave the toolbar showing a mixed state.
 */
let badgeChain: Promise<void> = Promise.resolve();

function renderBadge(): Promise<void> {
  const next = badgeChain.then(() => writeBadge());
  badgeChain = next.catch((err) => console.warn("[background] Badge render failed:", err));
  return next;
}

async function writeBadge(): Promise<void> {
  const update = nextBadge(badge, badgeInputFor(session, activeTabId));
  if (!update) return;
  badge = update;
  if (!update.text) {
    await setBadgeText("");
    return;
  }
  if (update.color) await setBadgeColor(update.color);
  await setBadgeText(update.text);
}

async function persistSession(): Promise<void> {
  try {
    await sessionSet({ [SESSION_STORAGE_KEY]: session });
  } catch (err) {
    console.warn("[background] Session mirror could not be persisted:", err);
  }
}

/* ------------------------------------------------------------------ handover */

/**
 * The one path that moves the capture: let the offscreen document do
 * gate → settings → stream → gate, and keep the old capture untouched whenever
 * any step fails. Enqueued so a rapid follow never overlaps a popup request.
 */
function handover(tabId: number, origin: string): Promise<RuntimeResponse> {
  return captureQueue.run(() => performHandover(tabId, origin));
}

async function performHandover(tabId: number, origin: string): Promise<RuntimeResponse> {
  try {
    await ensureOffscreen();
    const streamId = await getMediaStreamId(tabId);
    const settings = await readSiteSettings(origin);
    const response = await sendToOffscreen(
      { type: "SWITCH_CAPTURE", streamId, tabId, origin, settings },
      HANDOVER_TIMEOUT_MS,
    );
    if (response?.ok) {
      session = withTarget(session, tabId, origin);
      await persistSession();
      await renderBadge();
    }
    return response;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Settings-only re-apply for the captured tab navigating to a new origin. */
function reapplySettings(tabId: number, origin: string): Promise<void> {
  return captureQueue.run(() => performReapplySettings(tabId, origin));
}

async function performReapplySettings(tabId: number, origin: string): Promise<void> {
  const settings = await readSiteSettings(origin);
  const response = await sendToOffscreen(
    { type: "SWITCH_CAPTURE", streamId: null, tabId, origin, settings },
    HANDOVER_TIMEOUT_MS,
  );
  if (!response?.ok) {
    console.warn("[background] Settings re-apply failed:", response?.error);
    return;
  }
  session = withTarget(session, tabId, origin);
  await persistSession();
  await renderBadge();
}

function releaseCapture(): Promise<RuntimeResponse> {
  return captureQueue.run(async () => {
    const response = await sendToOffscreen({ type: "STOP_CAPTURE" }, STATE_TIMEOUT_MS);
    session = EMPTY_SESSION;
    await persistSession();
    await renderBadge();
    return response;
  });
}

/* ------------------------------------------------------------- auto-follow */

/**
 * Brings the cached session back in line with the offscreen document.
 * "No answer" is not the same as "idle": the mirror is a cache, so a failed
 * reconcile keeps it and lets the next handover's result decide — otherwise a
 * single timeout would silently disable auto-follow for the rest of the session.
 */
async function reconcile(): Promise<void> {
  const state = await getOffscreenState();
  if (!state) {
    console.warn("[background] Reconcile failed; keeping the cached session");
    return;
  }
  session = sessionFromState(session, state);
}

async function runFollow(tabId: number): Promise<void> {
  const tab = await getTab(tabId);
  if (!tab?.id) return;

  await reconcile();
  const plan = planTabActivation({
    hasCapture: hasActiveCapture(session),
    capturedTabId: session.capturedTabId,
    tabId: tab.id,
    tabUrl: tab.url,
  });

  if (plan.action === "skip") {
    // Same tab, new origin: keep the stream and swap the remembered settings.
    if (plan.reason === "same-tab" && hasActiveCapture(session)) {
      const origin = originKey(tab.url);
      if (origin && origin !== session.capturedOrigin) await reapplySettings(tab.id, origin);
    }
    return;
  }

  const response = await handover(plan.tabId, plan.origin);
  if (!response?.ok) console.warn("[background] Follow aborted, keeping current capture:", response?.error);
}

function scheduleFollow(tabId: number): void {
  // Nothing to follow until a capture session exists; the mirror is persisted,
  // so an empty one means the offscreen document has nothing running either.
  if (!hasActiveCapture(session) && session.capturedTabId === null) return;
  pendingFollow = tabId;
  if (followTimer) clearTimeout(followTimer);
  followTimer = setTimeout(() => {
    followTimer = null;
    const target = pendingFollow;
    pendingFollow = null;
    if (target === null) return;
    void runFollow(target).catch((err) => console.warn("[background] Follow failed:", err));
  }, FOLLOW_DEBOUNCE_MS);
}

/* --------------------------------------------------------------- lifecycle */

/** Idempotent: runs on every wake, removes pre-ADR-0004 flat keys once. */
async function cleanupLegacyKeys(): Promise<void> {
  try {
    const data = await storageGet<Record<string, unknown>>([...LEGACY_SETTING_KEYS]);
    const stale = LEGACY_SETTING_KEYS.filter((key) => Object.hasOwn(data, key));
    if (stale.length > 0) {
      await storageRemove([...stale]);
      console.log("[background] Removed legacy settings:", stale.join(", "));
    }
  } catch (err) {
    console.warn("[background] Legacy cleanup failed:", err);
  }
}

async function restoreSession(): Promise<void> {
  try {
    const data = await sessionGet<Record<string, unknown>>([SESSION_STORAGE_KEY]);
    const stored = data[SESSION_STORAGE_KEY];
    if (stored && typeof stored === "object") {
      session = { ...EMPTY_SESSION, ...(stored as Partial<CaptureSession>) };
    }
  } catch (err) {
    console.warn("[background] Session restore failed:", err);
  }
}

async function bootstrap(): Promise<void> {
  await cleanupLegacyKeys();
  await restoreSession();
  const tab = await activeTab();
  if (tab?.id !== undefined) activeTabId = tab.id;
  await renderBadge();
}

/* ---------------------------------------------------------------- listeners */

const MESSAGE_TYPES = new Set(["REQUEST_CAPTURE", "RELEASE_CAPTURE", "CAPTURE_EVENT"]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const msg = message as Record<string, unknown>;
  const type = msg.type;
  if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) return false;

  if (type === "CAPTURE_EVENT") {
    session = sessionFromEvent({
      connected: msg.connected === true,
      captureLost: msg.captureLost === true,
      tabId: typeof msg.tabId === "number" ? msg.tabId : null,
      origin: typeof msg.origin === "string" ? msg.origin : null,
    });
    void persistSession();
    void renderBadge();
    sendResponse({ ok: true });
    return false;
  }

  if (type === "RELEASE_CAPTURE") {
    void releaseCapture()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  const tabId = msg.tabId;
  void (async (): Promise<RuntimeResponse> => {
    if (typeof tabId !== "number") return { ok: false, error: "A tab id is required" };
    const tab = await getTab(tabId);
    const origin = originKey(tab?.url);
    if (!origin) return { ok: false, error: "此分頁不支援擷取（僅限 http/https）" };
    return handover(tabId, origin);
  })()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId ?? null;
  void renderBadge();
  scheduleFollow(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only the captured tab matters here; activations are covered by onActivated.
  if (!changeInfo.url || session.capturedTabId !== tabId) return;
  scheduleFollow(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (session.capturedTabId !== tabId) return;
  session = { ...session, connected: false, captureLost: true };
  void persistSession();
  void renderBadge();
});

void bootstrap().catch((err) => console.error("[background] Startup failed:", err));
