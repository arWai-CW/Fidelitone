// popup controller - connection state, pitch controls, engine selection, and processing mode
// Capture lifecycle lives in the background service worker (ADR-0004): the popup
// only requests a capture, edits settings for the captured site, and reports
// where the audio is actually coming from.

import {
  applyCaptureState,
  clampPitch,
  connectionState,
  createPopupState,
  formatSemitones,
  isEngine,
  isProcessingLocked,
  isSettingsLocked,
  PITCH_MAX,
  PITCH_MIN,
  roundPitch,
  selectEngine,
  setBypass,
  setActiveTab,
  setCaptureIdentity,
  setConnected as updateConnectedState,
  setConnecting,
  showDivergenceBanner,
  type CaptureState,
  type Engine,
  type PopupState,
} from "./popup-state";
import {
  diffAgainstDefaults,
  originKey,
  resolveSiteSettings,
  siteStorageKey,
  type ResolvedSiteSettings,
} from "../lib/site-settings";

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
const engineSignalsmith = getElement<HTMLButtonElement>("engineSignalsmith");
const engineRubberband = getElement<HTMLButtonElement>("engineRubberband");
const tooltip = getElement<HTMLDivElement>("tooltip");

let popupState: PopupState = createPopupState();
/** Resolved settings of the captured site; the snapshot every edit writes back. */
let siteSettings: ResolvedSiteSettings = resolveSiteSettings(undefined);
let capturedTabTitle: string | null = null;
let loadedCapturedTabId: number | null = null;

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

  const accompanimentLocksRubberband = accompanimentCheckbox.checked;
  engineSignalsmith.disabled = locked;
  engineRubberband.disabled = locked || accompanimentLocksRubberband || !popupState.engineAvailability.rubberband;

  renderEngineState();
  updateBypassButtonState();
}

function connectionDetailFor(): string {
  if (popupState.connected && isSettingsLocked(popupState)) return "目前分頁與擷取分頁的網站不同";
  if (popupState.connected && showDivergenceBanner(popupState)) return "音訊來自另一個分頁";
  if (popupState.connected) return "目前分頁音訊正在處理";
  return "開啟分頁音訊後會自動連線";
}

function renderConnectionState() {
  const state = connectionState(popupState);
  body.dataset.connectionState = state;

  if (state === "connecting") {
    connectionText.textContent = "連線中";
    connectionHeadline.textContent = "正在建立音訊通道";
    connectionDetail.textContent = "請不要關閉目前分頁";
    connectBtn.setAttribute("aria-label", "正在連線");
    connectBtn.setAttribute("data-tooltip", "正在連線...");
  } else if (state === "connected") {
    connectionText.textContent = "已連線";
    connectionHeadline.textContent = "音訊通道已建立";
    connectionDetail.textContent = connectionDetailFor();
    connectBtn.setAttribute("aria-label", "斷開連線");
    connectBtn.setAttribute("data-tooltip", "斷開連線");
  } else if (state === "lost") {
    connectionText.textContent = "連線中斷";
    connectionHeadline.textContent = "音訊通道已中斷";
    connectionDetail.textContent = "重新連線後可繼續處理";
    connectBtn.setAttribute("aria-label", "重新連線");
    connectBtn.setAttribute("data-tooltip", "重新連線");
  } else {
    connectionText.textContent = "尚未連線";
    connectionHeadline.textContent = "等待開始";
    connectionDetail.textContent = "開啟分頁音訊後會自動連線";
    connectBtn.setAttribute("aria-label", "連線音訊");
    connectBtn.setAttribute("data-tooltip", "連線音訊");
  }

  connectBtn.disabled = popupState.connecting;
  connectBtn.setAttribute("aria-busy", String(popupState.connecting));
  refreshControlAvailability();
  renderDivergence();
}

/** The audio can belong to another tab; say so and offer a re-capture. */
function renderDivergence() {
  const show = showDivergenceBanner(popupState);
  divergenceBanner.hidden = !show;
  if (!show) return;
  divergenceText.textContent = capturedTabTitle
    ? `目前音訊來自「${capturedTabTitle}」`
    : "目前音訊來自另一個分頁";
}

function showError(message: string, markLost = false) {
  errorMsg.textContent = message;
  errorMsg.classList.add("visible");
  if (markLost) {
    popupState = { ...popupState, captureLost: true };
    renderConnectionState();
  }
}

function clearError() {
  errorMsg.textContent = "";
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

/* ------------------------------------------------------- per-origin memory */

async function loadSiteSettings(origin: string): Promise<ResolvedSiteSettings> {
  const key = siteStorageKey(origin);
  const data = await storageGet<Record<string, unknown>>([key]);
  return resolveSiteSettings(data[key]);
}

/**
 * Writes the resolved snapshot back as a sparse record: returning a value to
 * its default deletes the field, and an all-default record deletes the key.
 */
async function persistSiteSettings(): Promise<void> {
  const origin = popupState.capturedOrigin;
  if (!origin) return;
  const key = siteStorageKey(origin);
  const sparse = diffAgainstDefaults(siteSettings);
  if (Object.keys(sparse).length === 0) await storageRemove([key]);
  else await storageSet({ [key]: sparse });
}

async function commitSiteSetting(patch: Partial<ResolvedSiteSettings>): Promise<boolean> {
  const previous = siteSettings;
  siteSettings = { ...siteSettings, ...patch };
  try {
    await persistSiteSettings();
    return true;
  } catch (err) {
    siteSettings = previous;
    showError(err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function rollbackSiteSetting(patch: Partial<ResolvedSiteSettings>): Promise<void> {
  siteSettings = { ...siteSettings, ...patch };
  await persistSiteSettings().catch(() => undefined);
}

function settingsFromLiveState(state: CaptureState): ResolvedSiteSettings {
  return resolveSiteSettings({
    pitch: state.pitch,
    bypass: state.bypass,
    preserveFormants: state.preserveFormants,
    accompanimentMode: state.accompanimentMode,
    engine: isEngine(state.selectedEngine) ? state.selectedEngine : state.engine,
  });
}

/** Storage is the memory of record; the live state is only the fallback. */
async function seedSiteSettings(state: CaptureState): Promise<void> {
  const origin = typeof state.origin === "string" ? state.origin : null;
  if (!origin) {
    siteSettings = settingsFromLiveState(state);
    return;
  }
  try {
    siteSettings = await loadSiteSettings(origin);
  } catch {
    siteSettings = settingsFromLiveState(state);
  }
}

async function refreshCapturedTabTitle(): Promise<void> {
  const tabId = popupState.capturedTabId;
  if (tabId === loadedCapturedTabId) return;
  loadedCapturedTabId = tabId;
  capturedTabTitle = tabId === null ? null : ((await getTabInfo(tabId))?.title ?? null);
  renderDivergence();
}

function getRouteLabel(route: string | null): string {
  if (!route) return "待命";
  if (route === "bypass") return "旁路";
  if (route === "accompaniment") return "伴奏";
  if (route === "passthrough") return "直通";
  if (route === "signalsmith") return "Signalsmith";
  if (route === "rubberband") return "RubberBand";
  return route;
}

function renderEngineState() {
  const accompanimentLocksRubberband = accompanimentCheckbox.checked;
  const engines: Array<[HTMLButtonElement, Engine]> = [
    [engineSignalsmith, "signalsmith"],
    [engineRubberband, "rubberband"],
  ];

  for (const [button, engine] of engines) {
    const selected = engine === popupState.selectedEngine;
    const available = popupState.engineAvailability[engine];
    const fixedForAccompaniment = accompanimentLocksRubberband && engine === "rubberband";
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.disabled = isProcessingLocked(popupState) || fixedForAccompaniment || (engine === "rubberband" && !available);
  }
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

function applySiteSettings(settings: ResolvedSiteSettings) {
  const pitch = clampPitch(settings.pitch);
  pitchSlider.value = String(pitch);
  updatePitchDisplay(pitch);

  popupState = setBypass(popupState, settings.bypass);
  formantCheckbox.checked = settings.preserveFormants;
  accompanimentCheckbox.checked = settings.accompanimentMode;
  popupState = selectEngine(popupState, settings.engine);

  renderEngineState();
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

  renderEngineState();
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

  if (!(await commitSiteSetting({ pitch: nextValue }))) {
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
      await rollbackSiteSetting({ pitch: previousValue });
    }
  }
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
  renderEngineState();
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
      await seedSiteSettings(state);
    } else {
      // State is briefly unavailable right after a handover: still attribute
      // later edits to the site we just captured.
      const origin = originKey(tab.url);
      popupState = setActiveTab(popupState, { id: tab.id, origin });
      if (origin) {
        popupState = setCaptureIdentity(popupState, { id: tab.id, origin });
        siteSettings = await loadSiteSettings(origin).catch(() => siteSettings);
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
  if (!(await commitSiteSetting({ preserveFormants: preserve }))) {
    formantCheckbox.checked = !preserve;
    return;
  }

  if (!(await sendSafe({ type: "SET_FORMANTS", value: { preserve } }))) {
    formantCheckbox.checked = !preserve;
    await rollbackSiteSetting({ preserveFormants: !preserve });
  }
});

accompanimentCheckbox.addEventListener("change", async () => {
  if (isProcessingLocked(popupState)) return;
  const enabled = accompanimentCheckbox.checked;
  if (!(await commitSiteSetting({ accompanimentMode: enabled }))) {
    accompanimentCheckbox.checked = !enabled;
    return;
  }

  renderEngineState();
  refreshControlAvailability();

  if (!(await sendSafe({ type: "SET_ACCOMPANIMENT", value: { enabled } }, true, ACCOMPANIMENT_COMMAND_TIMEOUT_MS))) {
    accompanimentCheckbox.checked = !enabled;
    await rollbackSiteSetting({ accompanimentMode: !enabled });
    renderEngineState();
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

  if (!(await commitSiteSetting({ bypass: popupState.bypass }))) {
    popupState = setBypass(popupState, previousBypass);
    updateBypassButtonState();
    return;
  }

  if (!(await sendSafe({ type: "SET_BYPASS", value: { active: popupState.bypass } }))) {
    popupState = setBypass(popupState, previousBypass);
    updateBypassButtonState();
    await rollbackSiteSetting({ bypass: previousBypass });
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

async function selectEngineFromUi(engine: Engine): Promise<void> {
  if (isProcessingLocked(popupState)) return;
  const previousEngine = popupState.selectedEngine;
  popupState = selectEngine(popupState, engine);
  renderEngineState();
  refreshControlAvailability();

  if (!(await commitSiteSetting({ engine }))) {
    popupState = selectEngine(popupState, previousEngine);
    renderEngineState();
    refreshControlAvailability();
    return;
  }

  if (!(await sendSafe({ type: "SET_ENGINE", engine }))) {
    popupState = selectEngine(popupState, previousEngine);
    renderEngineState();
    refreshControlAvailability();
    await rollbackSiteSetting({ engine: previousEngine });
  } else {
    await refreshRouteState();
  }
}

engineSignalsmith.addEventListener("click", () => void selectEngineFromUi("signalsmith"));
engineRubberband.addEventListener("click", () => void selectEngineFromUi("rubberband"));

async function initializePopup() {
  const activeTab = await queryActiveTab();
  popupState = setActiveTab(popupState, { id: activeTab?.id, origin: originKey(activeTab?.url) });
  const title = activeTab?.title ?? "No active tab";
  tabTitle.textContent = title;
  tabTitle.title = title;

  try {
    const global = await storageGet<{ snapToInteger?: boolean }>(["snapToInteger"]);
    applySnap(global.snapToInteger !== false);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }

  const liveState = await getCaptureState();
  if (liveState?.connected || liveState?.captureLost) {
    applyLiveState(liveState);
    setConnected(liveState.connected === true);
    await seedSiteSettings(liveState);
  } else {
    setConnected(false);
    // Opening the popup is the one gesture that grants tab capture, so a fresh
    // session connects the active tab automatically (ADR-0004).
    await connectCurrentTab();
  }

  renderConnectionState();
  attachTooltipListeners();
}

void initializePopup();
