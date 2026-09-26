// popup controller - connection state, pitch controls, signal path, and processing mode
// Capture lifecycle lives in the background service worker (ADR-0004): the popup
// only requests a capture, edits settings for the captured page, and reports
// where the audio is actually coming from.

import {
  applyCaptureState,
  clampPitch,
  connectionState,
  createPopupState,
  formatSemitones,
  isProcessingLocked,
  isSettingsLocked,
  PITCH_MAX,
  PITCH_MIN,
  roundPitch,
  setBypass,
  setActiveTab,
  setCaptureIdentity,
  setConnected as updateConnectedState,
  setConnecting,
  showDivergenceBanner,
  type CaptureState,
  type PopupState,
} from "./popup-state";
import {
  diffAgainstDefaults,
  isYouTubePage,
  pageKey,
  resolvePageSettings,
  pageStorageKey,
  YOUTUBE_BASE_VOLUME_DEFAULT,
  type ResolvedPageSettings,
} from "../lib/page-settings";
import {
  clampVolume,
  volumeDeltaPercent,
} from "../lib/volume";

interface RuntimeResponse {
  ok?: boolean;
  error?: string;
  ready?: boolean;
  state?: CaptureState;
}

const ACCOMPANIMENT_COMMAND_TIMEOUT_MS = 25000;
const HANDOVER_TIMEOUT_MS = 35000;
const RELEASE_TIMEOUT_MS = 8000;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
}

const body = document.body;
const tabTitle = getElement<HTMLDivElement>("tabTitle");
const connectionText = getElement<HTMLSpanElement>("connectionText");
const connectionHeadline = getElement<HTMLElement>("connectionHeadline");
const connectionDetail = getElement<HTMLSpanElement>("connectionDetail");
const connectBtn = getElement<HTMLButtonElement>("connectBtn");
const connectLabel = getElement<HTMLSpanElement>("connectLabel");
const railBand = getElement<HTMLElement>("railBand");
const youtubePanel = getElement<HTMLElement>("youtubePanel");
const memoryStrip = getElement<HTMLDivElement>("memoryStrip");
const memoryText = getElement<HTMLSpanElement>("memoryText");
const errorText = getElement<HTMLSpanElement>("errorText");
const bypassBtn = getElement<HTMLButtonElement>("bypassBtn");
const errorMsg = getElement<HTMLDivElement>("errorMsg");
const divergenceBanner = getElement<HTMLDivElement>("divergenceBanner");
const divergenceText = getElement<HTMLSpanElement>("divergenceText");
const captureThisTab = getElement<HTMLButtonElement>("captureThisTab");
const pitchNumber = getElement<HTMLSpanElement>("pitchNumber");
const pitchSlider = getElement<HTMLInputElement>("pitchSlider");
const pitchDown = getElement<HTMLButtonElement>("pitchDown");
const pitchUp = getElement<HTMLButtonElement>("pitchUp");
const pitchReset = getElement<HTMLButtonElement>("pitchReset");
const snapCheckbox = getElement<HTMLInputElement>("snapCheckbox");
const formantCheckbox = getElement<HTMLInputElement>("formantCheckbox");
const accompanimentCheckbox = getElement<HTMLInputElement>("accompanimentCheckbox");
const routeName = getElement<HTMLSpanElement>("routeName");
const routeDesc = getElement<HTMLSpanElement>("routeDesc");
const volumeCurrent = getElement<HTMLOutputElement>("volumeCurrent");
const volumeBaseInput = getElement<HTMLInputElement>("volumeBaseInput");
const volumeApplyBtn = getElement<HTMLButtonElement>("volumeApplyBtn");
const volumeFadeBtn = getElement<HTMLButtonElement>("volumeFadeBtn");
const volumeDeviation = getElement<HTMLParagraphElement>("volumeDeviation");
const youtubeHint = getElement<HTMLParagraphElement>("youtubeHint");
const tooltip = getElement<HTMLDivElement>("tooltip");

let popupState: PopupState = createPopupState();
/** Resolved settings of the captured page; the snapshot every edit writes back. */
let pageSettings: ResolvedPageSettings = resolvePageSettings(undefined);
/** 此頁在儲存層是否有稀疏記錄（頁面記憶是否成立）。 */
let pageMemorySaved = false;
let capturedTabTitle: string | null = null;
let loadedCapturedTabId: number | null = null;

/* ------------------------------------------------------- YouTube volume */
// Panel state (ADR-0005, revised by ADR-0006): a global baseline the user
// keeps and the live value read back from the page's <video>. Storage is the
// memory of record for the baseline; everything else is observation.

const YOUTUBE_DEFAULT_VOLUME = YOUTUBE_BASE_VOLUME_DEFAULT;

interface YoutubeTabResponse {
  ok?: boolean;
  error?: string;
  found?: boolean;
  volume?: number;
  muted?: boolean;
}

let youtube = {
  base: YOUTUBE_DEFAULT_VOLUME,
  found: false,
  volume: null as number | null,
  muted: false,
  /** Transport failure talking to the content script (distinct from "no <video>"). */
  error: null as string | null,
};

function getPitch(): number {
  const value = Number.parseFloat(pitchSlider.value);
  return Number.isFinite(value) ? value : 0;
}

function getPitchStep(): number {
  return snapCheckbox.checked ? 1 : 0.01;
}

function updatePitchDisplay(value: number) {
  pitchNumber.textContent = formatSemitones(value);
  pitchSlider.setAttribute("aria-valuetext", `${formatSemitones(value)} semitones`);
  // 打孔軌的折角旗與打孔格位置（0–1），CSS 以 thumb 寬度內縮對齊 range thumb。
  const pct = (value - PITCH_MIN) / (PITCH_MAX - PITCH_MIN);
  railBand.style.setProperty("--pitch-pct", String(pct));
}

function updateStepButtons() {
  const value = getPitch();
  pitchDown.disabled = value <= PITCH_MIN;
  pitchUp.disabled = value >= PITCH_MAX;
  pitchReset.disabled = value === 0;
}

function refreshControlAvailability() {
  const locked = isProcessingLocked(popupState);
  document.querySelectorAll<HTMLElement>(".control-lock").forEach((element) => {
    element.classList.toggle("is-disabled", locked);
    element.setAttribute("aria-disabled", String(locked));
  });

  pitchSlider.disabled = locked;
  pitchDown.disabled = locked || getPitch() <= PITCH_MIN;
  pitchUp.disabled = locked || getPitch() >= PITCH_MAX;
  pitchReset.disabled = locked || getPitch() === 0;
  snapCheckbox.disabled = locked;
  formantCheckbox.disabled = locked;
  accompanimentCheckbox.disabled = locked;
  bypassBtn.disabled = locked;

  renderRoute();
  updateBypassButtonState();
  renderYoutubePanel();
}

function connectionDetailFor(): string {
  if (popupState.connected && isSettingsLocked(popupState)) return "音訊尚未切到目前分頁，請先改擷取此分頁";
  if (popupState.connected && showDivergenceBanner(popupState)) return "音訊來自另一個分頁";
  if (popupState.connected) return "目前分頁音訊正在處理";
  return "按連線開始處理此分頁音訊";
}

function renderConnectionState() {
  const state = connectionState(popupState);
  body.dataset.connectionState = state;

  if (state === "connecting") {
    connectionText.textContent = "連線中";
    connectionHeadline.textContent = "正在建立音訊通道";
    connectionDetail.textContent = "請不要關閉目前分頁";
    connectLabel.textContent = "正在連線…";
    connectBtn.setAttribute("aria-label", "正在連線");
    connectBtn.setAttribute("data-tooltip", "正在連線...");
  } else if (state === "connected") {
    connectionText.textContent = "已連線";
    connectionHeadline.textContent = "音訊通道已建立";
    connectionDetail.textContent = connectionDetailFor();
    connectLabel.textContent = "斷開連線";
    connectBtn.setAttribute("aria-label", "斷開連線");
    connectBtn.setAttribute("data-tooltip", "斷開連線");
  } else if (state === "lost") {
    connectionText.textContent = "連線中斷";
    connectionHeadline.textContent = "音訊通道已中斷";
    connectionDetail.textContent = "重新連線後可繼續處理";
    connectLabel.textContent = "重新連線";
    connectBtn.setAttribute("aria-label", "重新連線");
    connectBtn.setAttribute("data-tooltip", "重新連線");
  } else {
    connectionText.textContent = "尚未連線";
    connectionHeadline.textContent = "等待開始";
    connectionDetail.textContent = "按連線開始處理此分頁音訊";
    connectLabel.textContent = "連線音訊";
    connectBtn.setAttribute("aria-label", "連線音訊");
    connectBtn.setAttribute("data-tooltip", "連線音訊");
  }

  connectBtn.disabled = popupState.connecting;
  connectBtn.setAttribute("aria-busy", String(popupState.connecting));
  refreshControlAvailability();
  renderDivergence();
  syncDivergenceWatch();
}

/** The audio can belong to another tab; say so and offer a re-capture. */
function renderDivergence() {
  const show = showDivergenceBanner(popupState);
  divergenceBanner.hidden = !show;
  renderMemoryState();
  if (!show) return;
  divergenceText.textContent = capturedTabTitle
    ? `目前音訊來自「${capturedTabTitle}」`
    : "目前音訊來自另一個分頁";
}

/* ------------------------------------------------------- 頁面記憶記號 */

type MemoryMode = "pending" | "saved" | "none" | "locked";

const MEMORY_COPY: Record<MemoryMode, string> = {
  pending: "頁面記憶 · 依頁面 URL 分開保存 · 連線後套用",
  saved: "頁面記憶 · 已套用此頁的設定",
  none: "頁面記憶 · 尚無記錄 · 變更會依頁面保存",
  locked: "頁面記憶 · 頁面不同 · 改擷取後套用",
};

/**
 * 頁面記憶的狀態記號：連線前尚未套用、連線後依稀疏記錄顯示已套用/無記錄、
 * 分頁不同時鎖定。文案一律帶 CONTEXT.md 的原詞「頁面記憶」。
 */
function renderMemoryState(): void {
  const mode: MemoryMode =
    connectionState(popupState) !== "connected"
      ? "pending"
      : isSettingsLocked(popupState)
        ? "locked"
        : pageMemorySaved
          ? "saved"
          : "none";
  memoryStrip.dataset.memory = mode;
  memoryText.textContent = MEMORY_COPY[mode];
}

/* ------------------------------------------------------- divergence watch */
// A tab switch is followed by the service worker after its own debounce, so a
// freshly opened popup can still describe the previous page and sit on a lock
// that is about to clear. Only a diverged popup watches, and only while the
// divergence lasts: an aligned popup sends nothing.
let divergenceWatch: number | null = null;
let divergenceWatchBusy = false;
const DIVERGENCE_POLL_MS = 600;

function syncDivergenceWatch() {
  const watching =
    popupState.connected &&
    !popupState.captureLost &&
    (isSettingsLocked(popupState) || showDivergenceBanner(popupState));
  if (!watching) {
    if (divergenceWatch !== null) {
      window.clearInterval(divergenceWatch);
      divergenceWatch = null;
    }
    return;
  }
  if (divergenceWatch !== null) return;
  divergenceWatch = window.setInterval(() => void refreshCapturedIdentity(), DIVERGENCE_POLL_MS);
}

/** Re-reads the capture identity; nothing else, so an open editor never jumps. */
async function refreshCapturedIdentity() {
  if (divergenceWatchBusy) return;
  divergenceWatchBusy = true;
  try {
    const state = await getCaptureState();
    if (!state) return;
    const moved =
      state.tabId !== popupState.capturedTabId || state.page !== popupState.capturedPage;
    if (!moved) return;
    applyLiveState(state);
    await seedPageSettings(state);
    renderDivergence();
  } catch {
    // Transient messaging failure: the watch keeps running and retries.
  } finally {
    divergenceWatchBusy = false;
    syncDivergenceWatch();
  }
}

function showError(message: string, markLost = false) {
  errorText.textContent = message;
  errorMsg.classList.add("visible");
  if (markLost) {
    popupState = { ...popupState, captureLost: true };
    renderConnectionState();
  }
}

function clearError() {
  errorText.textContent = "";
  errorMsg.classList.remove("visible");
}

function setConnected(nextConnected: boolean) {
  popupState = updateConnectedState(popupState, nextConnected);
  renderConnectionState();
}

function sendMessage<T extends RuntimeResponse = RuntimeResponse>(
  msg: Record<string, unknown>,
  retries = 0,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    };
    const timeout = setTimeout(() => {
      finish({ error: "Extension audio service did not respond" } as T);
    }, timeoutMs);
    const attempt = (remaining: number) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            if (remaining > 0) {
              setTimeout(() => attempt(remaining - 1), 200);
              return;
            }
            finish({ error: chrome.runtime.lastError.message } as T);
            return;
          }
          finish((response ?? { error: "Extension audio service returned no response" }) as T);
        });
      } catch (err) {
        finish({ error: err instanceof Error ? err.message : String(err) } as T);
      }
    };
    attempt(retries);
  });
}

async function sendSafe(
  msg: Record<string, unknown>,
  reportFailure = true,
  timeoutMs = 4000,
): Promise<boolean> {
  try {
    const response = await sendMessage<RuntimeResponse>(msg, 0, timeoutMs);
    if (response?.ok === true) return true;
    if (reportFailure) showError(response?.error ?? "Offscreen command failed");
    return false;
  } catch (err) {
    if (reportFailure) showError(err instanceof Error ? err.message : String(err));
    return false;
  }
}

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

function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void chrome.runtime.lastError;
      resolve(tabs[0] ?? null);
    });
  });
}

function getTabInfo(tabId: number): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      void chrome.runtime.lastError;
      resolve(tab ?? null);
    });
  });
}

/* ------------------------------------------------------- per-page memory */

async function loadPageSettings(page: string): Promise<ResolvedPageSettings> {
  const key = pageStorageKey(page);
  const data = await storageGet<Record<string, unknown>>([key]);
  const record = data[key];
  pageMemorySaved =
    typeof record === "object" && record !== null && Object.keys(record).length > 0;
  return resolvePageSettings(record);
}

/**
 * Writes the resolved snapshot back as a sparse record: returning a value to
 * its default deletes the field, and an all-default record deletes the key.
 */
async function persistPageSettings(): Promise<void> {
  const page = popupState.capturedPage;
  if (!page) return;
  const key = pageStorageKey(page);
  const sparse = diffAgainstDefaults(pageSettings);
  if (Object.keys(sparse).length === 0) {
    await storageRemove([key]);
    pageMemorySaved = false;
  } else {
    await storageSet({ [key]: sparse });
    pageMemorySaved = true;
  }
  renderMemoryState();
}

async function commitPageSetting(patch: Partial<ResolvedPageSettings>): Promise<boolean> {
  const previous = pageSettings;
  pageSettings = { ...pageSettings, ...patch };
  try {
    await persistPageSettings();
    return true;
  } catch (err) {
    pageSettings = previous;
    showError(err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function rollbackPageSetting(patch: Partial<ResolvedPageSettings>): Promise<void> {
  pageSettings = { ...pageSettings, ...patch };
  await persistPageSettings().catch(() => undefined);
}

function settingsFromLiveState(state: CaptureState): ResolvedPageSettings {
  return resolvePageSettings({
    pitch: state.pitch,
    bypass: state.bypass,
    preserveFormants: state.preserveFormants,
    accompanimentMode: state.accompanimentMode,
  });
}

/** Storage is the memory of record; the live state is only the fallback. */
async function seedPageSettings(state: CaptureState): Promise<void> {
  const page = typeof state.page === "string" ? state.page : null;
  if (!page) {
    pageSettings = settingsFromLiveState(state);
    pageMemorySaved = false;
    return;
  }
  try {
    pageSettings = await loadPageSettings(page);
  } catch {
    pageSettings = settingsFromLiveState(state);
  }
}

async function refreshCapturedTabTitle(): Promise<void> {
  const tabId = popupState.capturedTabId;
  if (tabId === loadedCapturedTabId) return;
  loadedCapturedTabId = tabId;
  capturedTabTitle = tabId === null ? null : ((await getTabInfo(tabId))?.title ?? null);
  renderDivergence();
}

/**
 * ADR-0007: one engine, so this is a readout rather than a choice. It earns its
 * place by reporting the fallback — if the engine never came up, the audio is
 * passing through unprocessed and the user is told instead of guessing from a
 * slider that appears to do nothing.
 */
const ROUTE_COPY: Record<string, { name: string; desc: string }> = {
  standby: { name: "待命", desc: "尚未連線" },
  signalsmith: { name: "Signalsmith", desc: "即時移調，節奏不變" },
  accompaniment: { name: "伴奏", desc: "低頻重取樣 ＋ 高頻時域拉伸" },
  bypass: { name: "旁路", desc: "擷取音訊未經處理直接輸出" },
  passthrough: { name: "未處理", desc: "移調引擎未啟動，音訊直接通過" },
};

function renderRoute() {
  const key = popupState.route ?? "standby";
  const copy = ROUTE_COPY[key] ?? ROUTE_COPY.standby;
  body.dataset.route = key;
  routeName.textContent = copy.name;
  routeDesc.textContent = copy.desc;
}

function updateBypassButtonState() {
  bypassBtn.setAttribute("aria-pressed", String(popupState.bypass));
  bypassBtn.setAttribute("aria-label", popupState.bypass ? "停用旁路" : "啟用旁路");
  bypassBtn.setAttribute("data-tooltip", popupState.bypass ? "停用旁路 (引擎處理)" : "啟用旁路 (原始音訊直通)");
}

function applySnap(snap: boolean) {
  snapCheckbox.checked = snap;
  pitchSlider.step = snap ? "1" : "0.01";
  if (snap) {
    const rounded = Math.round(getPitch());
    pitchSlider.value = String(rounded);
    updatePitchDisplay(rounded);
  }
  updateStepButtons();
}

function applyPageSettings(settings: ResolvedPageSettings) {
  const pitch = clampPitch(settings.pitch);
  pitchSlider.value = String(pitch);
  updatePitchDisplay(pitch);

  popupState = setBypass(popupState, settings.bypass);
  formantCheckbox.checked = settings.preserveFormants;
  accompanimentCheckbox.checked = settings.accompanimentMode;

  updateBypassButtonState();
  refreshControlAvailability();
}

function applyLiveState(state: CaptureState) {
  popupState = applyCaptureState(popupState, state);

  const pitch = typeof state.pitch === "number" ? clampPitch(state.pitch) : 0;
  pitchSlider.value = String(pitch);
  updatePitchDisplay(pitch);
  formantCheckbox.checked = state.preserveFormants === true;
  accompanimentCheckbox.checked = state.accompanimentMode === true;

  renderRoute();
  updateBypassButtonState();
  renderConnectionState();
  void refreshCapturedTabTitle();
}

async function updatePitch(value: number, send = true): Promise<void> {
  const previousValue = getPitch();
  const nextValue = clampPitch(roundPitch(value));
  pitchSlider.value = String(nextValue);
  updatePitchDisplay(nextValue);
  updateStepButtons();

  if (!(await commitPageSetting({ pitch: nextValue }))) {
    pitchSlider.value = String(previousValue);
    updatePitchDisplay(previousValue);
    updateStepButtons();
    return;
  }

  if (send && !isProcessingLocked(popupState)) {
    const ok = await sendSafe({ type: "SET_PITCH", value: { semitones: nextValue } }, false);
    if (!ok) {
      pitchSlider.value = String(previousValue);
      updatePitchDisplay(previousValue);
      updateStepButtons();
      await rollbackPageSetting({ pitch: previousValue });
    } else {
      flashRailCommit();
    }
  }
}

/** 提交成功時軌帶一閃——膠帶拍平的一下（reduced-motion 下由 CSS 停用）。 */
let railCommitTimer: number | null = null;
function flashRailCommit(): void {
  railBand.classList.add("is-committed");
  if (railCommitTimer !== null) window.clearTimeout(railCommitTimer);
  railCommitTimer = window.setTimeout(() => {
    railBand.classList.remove("is-committed");
    railCommitTimer = null;
  }, 340);
}

async function getCaptureState(): Promise<CaptureState | null> {
  const response = await sendMessage<RuntimeResponse>({ type: "GET_STATE" });
  if (response?.ok && response.state) return response.state;
  return null;
}

async function refreshRouteState(): Promise<void> {
  const state = await getCaptureState();
  if (!state) return;
  popupState = applyCaptureState(popupState, state);
  renderRoute();
}

/**
 * Asks the service worker to move the capture onto the active tab. The worker
 * owns the stream, so the popup never sends START/STOP_CAPTURE itself.
 */
async function connectCurrentTab(): Promise<boolean> {
  if (popupState.connecting) return false;
  popupState = setConnecting(popupState, true);
  renderConnectionState();
  clearError();

  try {
    const tab = await queryActiveTab();
    if (tab?.id === undefined) {
      showError("找不到目前分頁");
      return false;
    }

    const response = await sendMessage<RuntimeResponse>(
      { type: "REQUEST_CAPTURE", tabId: tab.id },
      0,
      HANDOVER_TIMEOUT_MS,
    );
    if (response?.ok !== true) {
      showError(response?.error ?? "Unable to start capture");
      return false;
    }

    loadedCapturedTabId = null;
    capturedTabTitle = null;
    setConnected(true);
    const state = await getCaptureState();
    if (state) {
      applyLiveState(state);
      await seedPageSettings(state);
    } else {
      // State is briefly unavailable right after a handover: still attribute
      // later edits to the page we just captured.
      const page = pageKey(tab.url);
      popupState = setActiveTab(popupState, { id: tab.id, page });
      if (page) {
        popupState = setCaptureIdentity(popupState, { id: tab.id, page });
        pageSettings = await loadPageSettings(page).catch(() => pageSettings);
      }
      void refreshCapturedTabTitle();
    }
    renderDivergence();
    return true;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    popupState = setConnecting(popupState, false);
    renderConnectionState();
  }
}

async function disconnectCapture(): Promise<boolean> {
  if (popupState.connecting) return false;
  popupState = setConnecting(popupState, true);
  renderConnectionState();
  clearError();

  try {
    const response = await sendMessage<RuntimeResponse>({ type: "RELEASE_CAPTURE" }, 0, RELEASE_TIMEOUT_MS);
    if (response?.ok !== true) {
      showError(response?.error ?? "Unable to stop capture");
      return false;
    }
    popupState = { ...popupState, captureLost: false };
    setConnected(false);
    loadedCapturedTabId = null;
    capturedTabTitle = null;
    return true;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    popupState = setConnecting(popupState, false);
    renderConnectionState();
  }
}

/* ------------------------------------------------------- YouTube volume */

function readBaseVolumeInput(): number {
  const raw = volumeBaseInput.value.trim();
  if (raw === "") return youtube.base;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampVolume(parsed) : youtube.base;
}

/** Talks to the content script of the tab the popup was opened on. */
function requestFromActiveTab(msg: Record<string, unknown>): Promise<YoutubeTabResponse> {
  const tabId = popupState.activeTabId;
  if (tabId === null) return Promise.resolve({ ok: false, error: "找不到目前分頁" });
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: describeMissingReceiver(err.message) });
        else resolve((response as YoutubeTabResponse | undefined) ?? { ok: false, error: "YouTube 控制項未回應" });
      });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * `Receiving end does not exist` means the content script never registered in
 * that tab — it is injected at page load, so a freshly (re)loaded extension
 * leaves older tabs without it. Say that instead of blaming the page.
 */
function describeMissingReceiver(message: string | undefined): string {
  if (message?.includes("Receiving end does not exist")) {
    return "影片控制項未載入：重載擴充功能後，請重新載入此分頁";
  }
  return message ?? "YouTube 控制項未回應";
}

async function refreshYoutubeState(): Promise<void> {
  if (!isYouTubePage(popupState.activePage)) {
    youtube.found = false;
    youtube.volume = null;
    youtube.muted = false;
    youtube.error = null;
    renderYoutubePanel();
    return;
  }
  const response = await requestFromActiveTab({ type: "YT_VOLUME_GET" });
  youtube.error = response.ok === true ? null : (response.error ?? "YouTube 控制項未回應");
  youtube.found = response.ok === true && response.found === true;
  youtube.volume = youtube.found && typeof response.volume === "number" ? response.volume : null;
  youtube.muted = response.muted === true;
  renderYoutubePanel();
}

/**
 * Every edit the panel performs is a plain volume write the content script
 * accepts on its own — no capture, no engine, no connection involved (ADR-0006
 * removed the one feature that needed a live signal: loudness analysis).
 */
function youtubeHintText(onYouTube: boolean): string {
  if (!onYouTube) return "此面板僅適用於 YouTube（www.youtube.com）";
  if (youtube.error) return youtube.error;
  if (!youtube.found) return "此頁面找不到影片";
  if (youtube.muted) return "影片已靜音；按「套用」設定音量會一併取消靜音";
  return "";
}

function deviationText(): string {
  if (!isYouTubePage(popupState.activePage)) return "切到 YouTube 頁面即可控制影片音量";
  if (!youtube.found) return "此頁面沒有可控制的影片";
  if (youtube.volume === null) return "按「套用」把基準音量寫入影片";
  if (youtube.volume <= 0) return "目前音量為 0";
  if (youtube.base <= 0) return "基準音量為 0";
  // Percentage, not dB: it is the number the slider itself speaks (ADR-0006).
  const delta = volumeDeltaPercent(youtube.volume, youtube.base);
  if (delta === 0) return "目前音量與基準一致";
  return `目前音量比基準${delta > 0 ? "高" : "低"} ${Math.abs(delta)}%`;
}

function renderYoutubePanel(): void {
  const onYouTube = isYouTubePage(popupState.activePage);
  // 非 YouTube 頁面不佔位：面板只在 YouTube 出現（其餘文案照舊）。
  youtubePanel.hidden = !onYouTube;
  if (document.activeElement !== volumeBaseInput) volumeBaseInput.value = String(youtube.base);

  if (!onYouTube || !youtube.found || youtube.volume === null) {
    volumeCurrent.textContent = "目前 —";
  } else if (youtube.muted) {
    volumeCurrent.textContent = "目前 靜音";
  } else {
    volumeCurrent.textContent = `目前 ${Math.round(youtube.volume)}`;
  }

  volumeApplyBtn.disabled = !youtube.found;
  volumeFadeBtn.disabled = !youtube.found;
  volumeDeviation.textContent = deviationText();
  youtubeHint.textContent = youtubeHintText(onYouTube);
}

async function persistBaseVolume(value: number): Promise<boolean> {
  const previous = youtube.base;
  youtube.base = value;
  try {
    if (value === YOUTUBE_DEFAULT_VOLUME) await storageRemove(["youtubeBaseVolume"]);
    else await storageSet({ youtubeBaseVolume: value });
    renderYoutubePanel();
    return true;
  } catch (err) {
    youtube.base = previous;
    showError(err instanceof Error ? err.message : String(err));
    renderYoutubePanel();
    return false;
  }
}

async function setYoutubeVolume(value: number): Promise<boolean> {
  const target = clampVolume(value);
  const response = await requestFromActiveTab({ type: "YT_VOLUME_SET", value: target });
  if (response.ok !== true) {
    showError(response.error ?? "無法設定影片音量");
    return false;
  }
  youtube.volume = target;
  if (target > 0) youtube.muted = false;
  renderYoutubePanel();
  return true;
}

/* Tooltip handling */
let tooltipHideTimer: number | null = null;

function showTooltip(element: HTMLElement) {
  const text = element.getAttribute("data-tooltip");
  if (!text) return;

  tooltip.textContent = text;
  tooltip.classList.add("visible");

  const rect = element.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - 8;

  // Keep tooltip within viewport
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (left < 8) left = 8;
  if (left + tooltipRect.width > viewportWidth - 8) left = viewportWidth - tooltipRect.width - 8;
  if (top < 8) {
    top = rect.bottom + 8;
    tooltip.style.transform = "translateX(-50%) rotate(180deg)";
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    return;
  }

  tooltip.style.transform = "translateX(-50%)";
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function hideTooltip() {
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }
  tooltip.classList.remove("visible");
}

function scheduleHideTooltip() {
  tooltipHideTimer = window.setTimeout(hideTooltip, 200);
}

// Attach tooltip listeners to all elements with data-tooltip
function attachTooltipListeners() {
  const elements = document.querySelectorAll<HTMLElement>("[data-tooltip]");
  elements.forEach((el) => {
    el.addEventListener("mouseenter", () => {
      if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
      }
      showTooltip(el);
    });
    el.addEventListener("mouseleave", scheduleHideTooltip);
    el.addEventListener("focus", () => showTooltip(el));
    el.addEventListener("blur", scheduleHideTooltip);
  });

  // Also hide tooltip when clicking elsewhere
  document.addEventListener("click", () => hideTooltip());
}

snapCheckbox.addEventListener("change", () => {
  if (isProcessingLocked(popupState)) return;
  const snap = snapCheckbox.checked;
  applySnap(snap);
  void storageSet({ snapToInteger: snap }).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
  void updatePitch(getPitch(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

formantCheckbox.addEventListener("change", async () => {
  if (isProcessingLocked(popupState)) return;
  const preserve = formantCheckbox.checked;
  if (!(await commitPageSetting({ preserveFormants: preserve }))) {
    formantCheckbox.checked = !preserve;
    return;
  }

  if (!(await sendSafe({ type: "SET_FORMANTS", value: { preserve } }))) {
    formantCheckbox.checked = !preserve;
    await rollbackPageSetting({ preserveFormants: !preserve });
  }
});

accompanimentCheckbox.addEventListener("change", async () => {
  if (isProcessingLocked(popupState)) return;
  const enabled = accompanimentCheckbox.checked;
  if (!(await commitPageSetting({ accompanimentMode: enabled }))) {
    accompanimentCheckbox.checked = !enabled;
    return;
  }

  refreshControlAvailability();

  if (!(await sendSafe({ type: "SET_ACCOMPANIMENT", value: { enabled } }, true, ACCOMPANIMENT_COMMAND_TIMEOUT_MS))) {
    accompanimentCheckbox.checked = !enabled;
    await rollbackPageSetting({ accompanimentMode: !enabled });
    refreshControlAvailability();
  } else {
    await refreshRouteState();
  }
});

connectBtn.addEventListener("click", async () => {
  if (popupState.connected) {
    await disconnectCapture();
  } else {
    await connectCurrentTab();
  }
});

captureThisTab.addEventListener("click", async () => {
  clearError();
  const ok = await connectCurrentTab();
  if (ok) {
    loadedCapturedTabId = null;
    const state = await getCaptureState();
    if (state) applyLiveState(state);
    renderDivergence();
  }
});

bypassBtn.addEventListener("click", async () => {
  // Allow bypass toggle even when bypassed (but not when disconnected/connecting/lost)
  if (isProcessingLocked(popupState)) return;
  const previousBypass = popupState.bypass;
  popupState = setBypass(popupState, !previousBypass);
  updateBypassButtonState();

  if (!(await commitPageSetting({ bypass: popupState.bypass }))) {
    popupState = setBypass(popupState, previousBypass);
    updateBypassButtonState();
    return;
  }

  if (!(await sendSafe({ type: "SET_BYPASS", value: { active: popupState.bypass } }))) {
    popupState = setBypass(popupState, previousBypass);
    updateBypassButtonState();
    await rollbackPageSetting({ bypass: previousBypass });
  } else {
    await refreshRouteState();
  }
});

pitchSlider.addEventListener("input", () => {
  if (isProcessingLocked(popupState)) return;
  void updatePitch(getPitch(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

pitchDown.addEventListener("click", () => {
  if (isProcessingLocked(popupState)) return;
  void updatePitch(getPitch() - getPitchStep(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

pitchUp.addEventListener("click", () => {
  if (isProcessingLocked(popupState)) return;
  void updatePitch(getPitch() + getPitchStep(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

pitchReset.addEventListener("click", () => {
  if (isProcessingLocked(popupState)) return;
  void updatePitch(0, true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

volumeBaseInput.addEventListener("change", () => {
  const value = readBaseVolumeInput();
  volumeBaseInput.value = String(value);
  void persistBaseVolume(value);
});

volumeApplyBtn.addEventListener("click", async () => {
  const value = readBaseVolumeInput();
  volumeBaseInput.value = String(value);
  if (!(await persistBaseVolume(value))) return;
  await setYoutubeVolume(value);
});

volumeFadeBtn.addEventListener("click", () => {
  // Fade out: the same 500 ms ramp every write uses, targeted at silence.
  void setYoutubeVolume(0);
});

async function initializePopup() {
  const activeTab = await queryActiveTab();
  popupState = setActiveTab(popupState, { id: activeTab?.id, page: pageKey(activeTab?.url) });
  const title = activeTab?.title ?? "No active tab";
  tabTitle.textContent = title;
  tabTitle.title = title;

  try {
    const global = await storageGet<{ snapToInteger?: boolean; youtubeBaseVolume?: number }>([
      "snapToInteger",
      "youtubeBaseVolume",
    ]);
    applySnap(global.snapToInteger !== false);
    youtube.base =
      typeof global.youtubeBaseVolume === "number" && Number.isFinite(global.youtubeBaseVolume)
        ? clampVolume(global.youtubeBaseVolume)
        : YOUTUBE_DEFAULT_VOLUME;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }

  const liveState = await getCaptureState();
  if (liveState?.connected || liveState?.captureLost) {
    applyLiveState(liveState);
    setConnected(liveState.connected === true);
    await seedPageSettings(liveState);
  } else {
    // ADR-0005 (amending ADR-0004): opening the popup no longer touches the
    // audio. The 連線 button is the only path that starts a capture.
    setConnected(false);
  }

  renderConnectionState();
  attachTooltipListeners();
  void refreshYoutubeState();
}

void initializePopup();
