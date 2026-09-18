// popup controller — pitch slider, bypass toggle, tab title, connection state

const slider = document.getElementById("pitchSlider") as HTMLInputElement;
const display = document.getElementById("pitchValue") as HTMLDivElement;
const bypassBtn = document.getElementById("bypassBtn") as HTMLButtonElement;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
const errorMsg = document.getElementById("errorMsg") as HTMLDivElement;
const tabTitle = document.getElementById("tabTitle") as HTMLDivElement;
const snapCheckbox = document.getElementById("snapCheckbox") as HTMLInputElement;
const formantCheckbox = document.getElementById("formantCheckbox") as HTMLInputElement;
const accompanimentCheckbox = document.getElementById("accompanimentCheckbox") as HTMLInputElement;

function formatSemitones(val: number): string {
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}`;
}

function showError(msg: string) {
  errorMsg.textContent = msg;
  errorMsg.classList.add("visible");
}

function clearError() {
  errorMsg.classList.remove("visible");
  errorMsg.textContent = "";
}

interface CaptureState {
  ready?: boolean;
  connected: boolean;
  pitch: number;
  bypass: boolean;
  preserveFormants: boolean;
  accompanimentMode: boolean;
  engine?: "rubberband" | "signalsmith";
  route?: string;
  captureLost?: boolean;
}

interface RuntimeResponse {
  ok?: boolean;
  error?: string;
  ready?: boolean;
  state?: CaptureState;
}

type StoredSettings = Partial<CaptureState> & {
  snapToInteger?: boolean;
};

function isEngine(value: unknown): value is "rubberband" | "signalsmith" {
  return value === "rubberband" || value === "signalsmith";
}

let connected = false;
let connecting = false;
let selectedEngine: "signalsmith" | "rubberband" = "rubberband";
// Accompaniment startup may wait for two AudioWorklet handshakes while other engines are active.
const ACCOMPANIMENT_COMMAND_TIMEOUT_MS = 25000;

function setConnected(nextConnected: boolean) {
  connected = nextConnected;
  if (connected) {
    document.body.classList.remove("disabled");
    connectBtn.textContent = "Disconnect";
    connectBtn.classList.add("connected");
  } else {
    document.body.classList.add("disabled");
    connectBtn.textContent = "Connect";
    connectBtn.classList.remove("connected");
  }
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
  return new Promise<T>((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data as T));
  });
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
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
  ]);
}

function updatePitchDisplay(val: number) {
  display.innerHTML = `${formatSemitones(val)}<small>st</small>`;
}

function applySnap(snap: boolean) {
  if (snap) {
    slider.step = "1";
    const rounded = Math.round(parseFloat(slider.value));
    slider.value = String(rounded);
    updatePitchDisplay(rounded);
  } else {
    slider.step = "0.01";
  }
}

function applyStoredUi(data: StoredSettings) {
  if (typeof data.pitch === "number") {
    slider.value = String(data.pitch);
    updatePitchDisplay(data.pitch);
  }

  const bypassed = data.bypass === true;
  bypassBtn.classList.toggle("bypassed", bypassed);
  bypassBtn.textContent = bypassed ? "Bypassed" : "Active";

  const snap = data.snapToInteger !== false;
  snapCheckbox.checked = snap;
  applySnap(snap);

  formantCheckbox.checked = data.preserveFormants === true;
  accompanimentCheckbox.checked = data.accompanimentMode === true;
  selectEngineButton(selectedEngine);
}

async function getCaptureState(): Promise<CaptureState | null> {
  const response = await sendMessage<{ ok?: boolean; ready?: boolean; state?: CaptureState; error?: string }>({ type: "GET_STATE" });
  if (response?.ok && response.state) return response.state;
  return null;
}

async function restoreCaptureSettings(data: Partial<CaptureState>) {
  const commands: Array<Record<string, unknown>> = [];
  if (typeof data.pitch === "number") {
    commands.push({ type: "SET_PITCH", value: { semitones: data.pitch } });
  }
  commands.push({ type: "SET_BYPASS", value: { active: data.bypass === true } });
  commands.push({ type: "SET_FORMANTS", value: { preserve: data.preserveFormants === true } });
  commands.push({ type: "SET_ACCOMPANIMENT", value: { enabled: data.accompanimentMode === true } });

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

async function connectCurrentTab(): Promise<boolean> {
  if (connecting) return false;
  connecting = true;
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting…";
  clearError();

  try {
    await ensureOffscreen();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showError("No active tab found");
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
      const state = await getCaptureState();
      if (!state) throw new Error("Audio service did not report connection state");
      if (isEngine(state.engine)) selectEngineButton(state.engine);
      await restoreCaptureSettings(state);
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      connecting = false;
      await disconnectCapture();
      return false;
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    connecting = false;
    connectBtn.disabled = false;
    if (!connected) connectBtn.textContent = "Connect";
  }
}

async function disconnectCapture(): Promise<boolean> {
  if (connecting) return false;
  connecting = true;
  connectBtn.disabled = true;
  connectBtn.textContent = "Disconnecting…";
  clearError();

  try {
    const response = await sendMessage<RuntimeResponse>({ type: "STOP_CAPTURE" });
    if (response?.ok !== true) {
      showError(response?.error ?? "Unable to stop capture");
      return false;
    }
    setConnected(false);
    await storageSet({ connected: false });
    return true;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    connecting = false;
    connectBtn.disabled = false;
    if (!connected) connectBtn.textContent = "Connect";
  }
}

async function syncConnectionState(): Promise<CaptureState | null> {
  const response = await sendMessage<{ ok?: boolean; ready?: boolean; state?: CaptureState; error?: string }>({ type: "GET_STATE" });
  if (!response?.ok || !response.state) return null;
  if (response.ready === false) return null;

  if (isEngine(response.state.engine)) {
    selectEngineButton(response.state.engine);
  }
  setConnected(response.state.connected);
  await storageSet({ connected: response.state.connected });
  await restoreCaptureSettings(response.state);
  return response.state;
}

// --- Snap to integer logic ---
snapCheckbox.addEventListener("change", () => {
  const snap = snapCheckbox.checked;
  applySnap(snap);
  void storageSet({ snapToInteger: snap });
});

// --- Preserve Formants toggle ---
formantCheckbox.addEventListener("change", async () => {
  const preserve = formantCheckbox.checked;
  await storageSet({ preserveFormants: preserve });
  if (!(await sendSafe({ type: "SET_FORMANTS", value: { preserve } }))) {
    formantCheckbox.checked = !preserve;
    await storageSet({ preserveFormants: !preserve });
  }
});

// --- Accompaniment mode toggle ---
accompanimentCheckbox.addEventListener("change", async () => {
  const enabled = accompanimentCheckbox.checked;
  await storageSet({ accompanimentMode: enabled });
  if (!(await sendSafe({ type: "SET_ACCOMPANIMENT", value: { enabled } }, true, ACCOMPANIMENT_COMMAND_TIMEOUT_MS))) {
    accompanimentCheckbox.checked = !enabled;
    await storageSet({ accompanimentMode: !enabled });
  }
});

// --- Connect / Disconnect button ---
connectBtn.addEventListener("click", async () => {
  if (connected) {
    await disconnectCapture();
  } else {
    await connectCurrentTab();
  }
});

// --- Slider ---
slider.addEventListener("input", async () => {
  const val = parseFloat(slider.value);
  const previousValue = slider.value;
  updatePitchDisplay(val);
  await storageSet({ pitch: val });
  if (!(await sendSafe({ type: "SET_PITCH", value: { semitones: val } }, false)) && connected) {
    slider.value = previousValue;
    updatePitchDisplay(parseFloat(previousValue));
    await storageSet({ pitch: parseFloat(previousValue) });
  }
});

// --- Debug mode (A/B comparison) ---
let debugMode = false;
const abContainer = document.createElement("div");
abContainer.id = "abContainer";
abContainer.style.cssText = "display:none;margin-top:8px;padding:8px;background:#1a1a2e;border:1px solid #2a2a4a;border-radius:6px;";
abContainer.innerHTML = `
  <div style="font-size:11px;color:#888;margin-bottom:6px;">A/B Engine Comparison</div>
  <div style="display:flex;gap:6px;">
    <button id="btnA" class="ab-btn" style="flex:1;padding:6px;font-size:12px;border:1px solid #2a2a4a;border-radius:4px;cursor:pointer;background:#1b4332;color:#40c057;">A (Signalsmith)</button>
    <button id="btnB" class="ab-btn" style="flex:1;padding:6px;font-size:12px;border:1px solid #2a2a4a;border-radius:4px;cursor:pointer;background:#1b2a4a;color:#6c9cff;">B (RB LiveShifter)</button>
  </div>
`;
bypassBtn.parentNode?.insertBefore(abContainer, bypassBtn.nextSibling);

const btnA = document.getElementById("btnA") as HTMLButtonElement;
const btnB = document.getElementById("btnB") as HTMLButtonElement;

function selectEngineButton(engine: "signalsmith" | "rubberband") {
  selectedEngine = engine;
  btnA.style.background = engine === "signalsmith" ? "#1b4332" : "#1a1a2e";
  btnA.style.color = engine === "signalsmith" ? "#40c057" : "#666";
  btnB.style.background = engine === "rubberband" ? "#1b2a4a" : "#1a1a2e";
  btnB.style.color = engine === "rubberband" ? "#6c9cff" : "#666";
}

btnA.addEventListener("click", async () => {
  selectEngineButton("signalsmith");
  if (!(await sendSafe({ type: "SET_ENGINE", engine: "signalsmith" }))) {
    selectEngineButton(selectedEngine === "signalsmith" ? "rubberband" : "signalsmith");
  }
});

btnB.addEventListener("click", async () => {
  selectEngineButton("rubberband");
  if (!(await sendSafe({ type: "SET_ENGINE", engine: "rubberband" }))) {
    selectEngineButton(selectedEngine === "rubberband" ? "signalsmith" : "rubberband");
  }
});

// --- Bypass toggle (with Shift+click for debug mode) ---
bypassBtn.addEventListener("click", async (e) => {
  if (e.shiftKey) {
    debugMode = !debugMode;
    abContainer.style.display = debugMode ? "block" : "none";
    console.log(`[A/B] Debug mode ${debugMode ? "ON" : "OFF"}`);
    return;
  }
  const isBypassed = bypassBtn.classList.toggle("bypassed");
  const previousText = bypassBtn.textContent;
  bypassBtn.textContent = isBypassed ? "Bypassed" : "Active";
  await storageSet({ bypass: isBypassed });
  if (!(await sendSafe({ type: "SET_BYPASS", value: { active: isBypassed } }))) {
    bypassBtn.classList.toggle("bypassed");
    bypassBtn.textContent = previousText;
    await storageSet({ bypass: !isBypassed });
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const title = tabs[0]?.title ?? "No active tab";
  tabTitle.textContent = title;
});

async function initializePopup() {
  const stored = await getStoredSettings();
  applyStoredUi(stored);

  let liveState: CaptureState | null = null;
  try {
    await ensureOffscreen();
    liveState = await syncConnectionState();
  } catch (err) {
    console.warn("[popup] State synchronization failed:", err);
  }

  const currentStored = await getStoredSettings();
  const storedConnected = typeof currentStored.connected === "boolean" ? currentStored.connected : null;
  if (liveState) {
    setConnected(liveState.connected);
  } else if (storedConnected === false) {
    setConnected(false);
  } else {
    await connectCurrentTab();
  }
}

void initializePopup();
