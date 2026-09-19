// popup controller - connection state, pitch controls, engine selection, and processing mode

type Engine = "signalsmith" | "rubberband";
type ConnectionState = "disconnected" | "connecting" | "connected" | "lost";

interface EngineAvailability {
  signalsmith: boolean;
  rubberband: boolean;
}

interface CaptureState {
  ready?: boolean;
  connected: boolean;
  pitch: number;
  bypass: boolean;
  preserveFormants: boolean;
  accompanimentMode: boolean;
  engine?: Engine;
  selectedEngine?: Engine;
  route?: string;
  captureLost?: boolean;
  engineAvailability?: EngineAvailability;
}

interface RuntimeResponse {
  ok?: boolean;
  error?: string;
  ready?: boolean;
  state?: CaptureState;
}

type StoredSettings = Partial<CaptureState> & {
  snapToInteger?: boolean;
  engine?: Engine;
};

const PITCH_MIN = -12;
const PITCH_MAX = 12;
const ACCOMPANIMENT_COMMAND_TIMEOUT_MS = 25000;

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

let connected = false;
let connecting = false;
let captureLost = false;
let isBypassed = false;
let selectedEngine: Engine = "rubberband";
let currentRoute: string | null = null;
let engineAvailability: EngineAvailability = {
  signalsmith: false,
  rubberband: false,
};

function isEngine(value: unknown): value is Engine {
  return value === "rubberband" || value === "signalsmith";
}

function isProcessingLocked(): boolean {
  return !connected || connecting || captureLost;
}

function clampPitch(value: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, value));
}

function roundPitch(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatSemitones(value: number): string {
  const rounded = roundPitch(value);
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded.toFixed(2)}`;
}

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
  const locked = !connected || connecting || captureLost;
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
  engineRubberband.disabled = locked || accompanimentLocksRubberband || !engineAvailability.rubberband;

  renderEngineState();
  updateBypassButtonState();
}

function renderConnectionState() {
  const state: ConnectionState = connecting ? "connecting" : captureLost ? "lost" : connected ? "connected" : "disconnected";
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
    connectionDetail.textContent = "目前分頁音訊正在處理";
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

  connectBtn.disabled = connecting;
  connectBtn.setAttribute("aria-busy", String(connecting));
  refreshControlAvailability();
}

function showError(message: string, markLost = false) {
  errorMsg.textContent = message;
  errorMsg.classList.add("visible");
  if (markLost) {
    captureLost = true;
    renderConnectionState();
  }
}

function clearError() {
  errorMsg.textContent = "";
  errorMsg.classList.remove("visible");
}

function setConnected(nextConnected: boolean) {
  connected = nextConnected;
  if (!connected) captureLost = false;
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

async function getStoredSettings(): Promise<StoredSettings> {
  return storageGet<StoredSettings>([
    "connected",
    "pitch",
    "bypass",
    "preserveFormants",
    "accompanimentMode",
    "snapToInteger",
    "engine",
  ]);
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
    const selected = engine === selectedEngine;
    const available = engineAvailability[engine];
    const fixedForAccompaniment = accompanimentLocksRubberband && engine === "rubberband";
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.disabled = !connected || connecting || captureLost || fixedForAccompaniment || (engine === "rubberband" && !available);
  }
}

function updateBypassButtonState() {
  bypassBtn.setAttribute("aria-pressed", String(isBypassed));
  bypassBtn.setAttribute("aria-label", isBypassed ? "停用旁路" : "啟用旁路");
  bypassBtn.setAttribute("data-tooltip", isBypassed ? "停用旁路 (引擎處理)" : "啟用旁路 (原始音訊直通)");
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

function applyStoredUi(data: StoredSettings) {
  const pitch = typeof data.pitch === "number" ? clampPitch(data.pitch) : 0;
  pitchSlider.value = String(pitch);
  updatePitchDisplay(pitch);

  isBypassed = data.bypass === true;
  applySnap(data.snapToInteger !== false);
  formantCheckbox.checked = data.preserveFormants === true;
  accompanimentCheckbox.checked = data.accompanimentMode === true;
  selectedEngine = isEngine(data.engine) ? data.engine : "rubberband";

  renderEngineState();
  updateBypassButtonState();
  refreshControlAvailability();
}

function applyLiveState(state: CaptureState) {
  selectedEngine = isEngine(state.selectedEngine) ? state.selectedEngine : isEngine(state.engine) ? state.engine : selectedEngine;
  currentRoute = state.route ?? null;
  captureLost = state.captureLost === true;
  isBypassed = state.bypass === true;
  engineAvailability = state.engineAvailability ?? {
    signalsmith: selectedEngine === "signalsmith",
    rubberband: selectedEngine === "rubberband",
  };

  const pitch = typeof state.pitch === "number" ? clampPitch(state.pitch) : 0;
  pitchSlider.value = String(pitch);
  updatePitchDisplay(pitch);
  formantCheckbox.checked = state.preserveFormants === true;
  accompanimentCheckbox.checked = state.accompanimentMode === true;

  renderEngineState();
  updateBypassButtonState();
  renderConnectionState();
}

async function restoreStoredSettings(): Promise<void> {
  const stored = await getStoredSettings();
  const commands: Array<Record<string, unknown>> = [];

  if (typeof stored.pitch === "number") {
    commands.push({ type: "SET_PITCH", value: { semitones: clampPitch(stored.pitch) } });
  }
  commands.push({ type: "SET_BYPASS", value: { active: stored.bypass === true } });
  commands.push({ type: "SET_FORMANTS", value: { preserve: stored.preserveFormants === true } });
  if (isEngine(stored.engine) && stored.accompanimentMode !== true) {
    commands.push({ type: "SET_ENGINE", engine: stored.engine });
  }
  commands.push({ type: "SET_ACCOMPANIMENT", value: { enabled: stored.accompanimentMode === true } });

  for (const command of commands) {
    const response = await sendMessage<RuntimeResponse>(
      command,
      0,
      command.type === "SET_ACCOMPANIMENT" ? ACCOMPANIMENT_COMMAND_TIMEOUT_MS : 4000,
    );
    if (response?.ok !== true) {
      throw new Error(response?.error ?? "Unable to restore audio settings");
    }
  }
}

async function updatePitch(value: number, send = true): Promise<void> {
  const previousValue = getPitch();
  const nextValue = clampPitch(roundPitch(value));
  pitchSlider.value = String(nextValue);
  updatePitchDisplay(nextValue);
  updateStepButtons();
  await storageSet({ pitch: nextValue });

  if (send && connected && !connecting && !captureLost) {
    const ok = await sendSafe({ type: "SET_PITCH", value: { semitones: nextValue } }, false);
    if (!ok) {
      pitchSlider.value = String(previousValue);
      updatePitchDisplay(previousValue);
      updateStepButtons();
      await storageSet({ pitch: previousValue });
    }
  }
}

async function ensureOffscreen(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA" as chrome.offscreen.Reason, "AUDIO_PLAYBACK" as chrome.offscreen.Reason],
    justification: "Tab audio capture and processed AudioWorklet playback",
  });
}

async function getCaptureState(): Promise<CaptureState | null> {
  const response = await sendMessage<{ ok?: boolean; ready?: boolean; state?: CaptureState; error?: string }>({ type: "GET_STATE" });
  if (response?.ok && response.state) return response.state;
  return null;
}

async function refreshRouteState(): Promise<void> {
  const state = await getCaptureState();
  if (!state) return;
  currentRoute = state.route ?? currentRoute;
  engineAvailability = state.engineAvailability ?? engineAvailability;
  selectedEngine = isEngine(state.selectedEngine) ? state.selectedEngine : selectedEngine;
  renderEngineState();
}

async function connectCurrentTab(): Promise<boolean> {
  if (connecting) return false;
  connecting = true;
  renderConnectionState();
  clearError();

  try {
    await ensureOffscreen();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showError("找不到目前分頁");
      return false;
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const response = await sendMessage<RuntimeResponse>({ type: "START_CAPTURE", streamId });
    if (response?.ok !== true) {
      showError(response?.error ?? "Unable to start capture");
      return false;
    }

    setConnected(true);
    await storageSet({ connected: true });
    try {
      await restoreStoredSettings();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }

    const state = await getCaptureState();
    if (state) applyLiveState(state);
    return true;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    connecting = false;
    renderConnectionState();
  }
}

async function disconnectCapture(): Promise<boolean> {
  if (connecting) return false;
  connecting = true;
  renderConnectionState();
  clearError();

  try {
    const response = await sendMessage<RuntimeResponse>({ type: "STOP_CAPTURE" });
    if (response?.ok !== true) {
      showError(response?.error ?? "Unable to stop capture");
      return false;
    }
    captureLost = false;
    setConnected(false);
    await storageSet({ connected: false });
    return true;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    connecting = false;
    renderConnectionState();
  }
}

async function syncConnectionState(): Promise<CaptureState | null> {
  const response = await sendMessage<{ ok?: boolean; ready?: boolean; state?: CaptureState; error?: string }>({ type: "GET_STATE" });
  if (!response?.ok || !response.state || response.ready === false) return null;

  applyLiveState(response.state);
  setConnected(response.state.connected);
  await storageSet({ connected: response.state.connected });
  return response.state;
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
  if (isProcessingLocked()) return;
  const snap = snapCheckbox.checked;
  applySnap(snap);
  void storageSet({ snapToInteger: snap }).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
  void updatePitch(getPitch(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

formantCheckbox.addEventListener("change", async () => {
  if (isProcessingLocked()) return;
  const preserve = formantCheckbox.checked;
  try {
    await storageSet({ preserveFormants: preserve });
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    formantCheckbox.checked = !preserve;
    return;
  }

  if (!(await sendSafe({ type: "SET_FORMANTS", value: { preserve } }))) {
    formantCheckbox.checked = !preserve;
    await storageSet({ preserveFormants: !preserve }).catch(() => undefined);
  }
});

accompanimentCheckbox.addEventListener("change", async () => {
  if (isProcessingLocked()) return;
  const enabled = accompanimentCheckbox.checked;
  try {
    await storageSet({ accompanimentMode: enabled });
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    accompanimentCheckbox.checked = !enabled;
    return;
  }

  renderEngineState();
  refreshControlAvailability();

  if (!(await sendSafe({ type: "SET_ACCOMPANIMENT", value: { enabled } }, true, ACCOMPANIMENT_COMMAND_TIMEOUT_MS))) {
    accompanimentCheckbox.checked = !enabled;
    await storageSet({ accompanimentMode: !enabled }).catch(() => undefined);
    renderEngineState();
    refreshControlAvailability();
  } else {
    await refreshRouteState();
  }
});

connectBtn.addEventListener("click", async () => {
  if (connected) {
    await disconnectCapture();
  } else {
    await connectCurrentTab();
  }
});

bypassBtn.addEventListener("click", async () => {
  // Allow bypass toggle even when bypassed (but not when disconnected/connecting/lost)
  if (!connected || connecting || captureLost) return;
  const previousBypass = isBypassed;
  isBypassed = !isBypassed;
  updateBypassButtonState();
  await storageSet({ bypass: isBypassed }).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));

  if (!(await sendSafe({ type: "SET_BYPASS", value: { active: isBypassed } }))) {
    isBypassed = previousBypass;
    updateBypassButtonState();
    await storageSet({ bypass: previousBypass }).catch(() => undefined);
  } else {
    await refreshRouteState();
  }
});

pitchSlider.addEventListener("input", () => {
  if (isProcessingLocked()) return;
  void updatePitch(getPitch(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

pitchDown.addEventListener("click", () => {
  if (isProcessingLocked()) return;
  void updatePitch(getPitch() - getPitchStep(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

pitchUp.addEventListener("click", () => {
  if (isProcessingLocked()) return;
  void updatePitch(getPitch() + getPitchStep(), true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

pitchReset.addEventListener("click", () => {
  if (isProcessingLocked()) return;
  void updatePitch(0, true).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
});

engineSignalsmith.addEventListener("click", async () => {
  if (isProcessingLocked()) return;
  const previousEngine = selectedEngine;
  selectedEngine = "signalsmith";
  renderEngineState();
  refreshControlAvailability();
  await storageSet({ engine: selectedEngine }).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));

  if (!(await sendSafe({ type: "SET_ENGINE", engine: "signalsmith" }))) {
    selectedEngine = previousEngine;
    renderEngineState();
    refreshControlAvailability();
    await storageSet({ engine: selectedEngine }).catch(() => undefined);
  } else {
    await refreshRouteState();
  }
});

engineRubberband.addEventListener("click", async () => {
  if (isProcessingLocked()) return;
  const previousEngine = selectedEngine;
  selectedEngine = "rubberband";
  renderEngineState();
  refreshControlAvailability();
  await storageSet({ engine: selectedEngine }).catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));

  if (!(await sendSafe({ type: "SET_ENGINE", engine: "rubberband" }))) {
    selectedEngine = previousEngine;
    renderEngineState();
    refreshControlAvailability();
    await storageSet({ engine: selectedEngine }).catch(() => undefined);
  } else {
    await refreshRouteState();
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const title = tabs[0]?.title ?? "No active tab";
  tabTitle.textContent = title;
  tabTitle.title = title;
});

async function initializePopup() {
  let stored: StoredSettings = {};
  try {
    stored = await getStoredSettings();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
  applyStoredUi(stored);

  let liveState: CaptureState | null = null;
  try {
    await ensureOffscreen();
    liveState = await syncConnectionState();
  } catch (err) {
    console.warn("[popup] State synchronization failed:", err);
  }

  if (liveState) {
    applyLiveState(liveState);
    setConnected(liveState.connected);
  } else {
    let storedConnected: boolean | null = null;
    try {
      const currentStored = await getStoredSettings();
      storedConnected = typeof currentStored.connected === "boolean" ? currentStored.connected : null;
    } catch (err) {
      console.warn("[popup] Stored connection state unavailable:", err);
    }

    if (storedConnected === false) {
      setConnected(false);
    } else {
      await connectCurrentTab();
    }
  }

  // Attach tooltip listeners after DOM is ready
  attachTooltipListeners();
}

void initializePopup();