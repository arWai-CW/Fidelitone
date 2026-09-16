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

function setConnected(connected: boolean) {
  if (connected) {
    document.body.classList.remove("disabled");
    connectBtn.textContent = "Connected";
    connectBtn.classList.add("connected");
  } else {
    document.body.classList.add("disabled");
    connectBtn.textContent = "Connect";
    connectBtn.classList.remove("connected");
  }
}

function sendSafe(msg: Record<string, unknown>) {
  chrome.runtime.sendMessage(msg, () => {
    if (chrome.runtime.lastError) {
      console.warn("[popup] sendMessage failed:", chrome.runtime.lastError.message);
    }
  });
}

// --- Snap to integer logic ---
function applySnap(snap: boolean) {
  if (snap) {
    slider.step = "1";
    const rounded = Math.round(parseFloat(slider.value));
    slider.value = String(rounded);
    display.innerHTML = `${formatSemitones(rounded)}<small>st</small>`;
  } else {
    slider.step = "0.01";
  }
}

snapCheckbox.addEventListener("change", () => {
  const snap = snapCheckbox.checked;
  applySnap(snap);
  chrome.storage.local.set({ snapToInteger: snap });
});

// --- Preserve Formants toggle ---
formantCheckbox.addEventListener("change", () => {
  const preserve = formantCheckbox.checked;
  console.log("[popup] Formant toggle:", preserve);
  chrome.storage.local.set({ preserveFormants: preserve });
  sendSafe({ type: "SET_FORMANTS", value: { preserve } });
});

// --- Accompaniment mode toggle ---
accompanimentCheckbox.addEventListener("change", () => {
  const enabled = accompanimentCheckbox.checked;
  console.log("[popup] Accompaniment mode:", enabled);
  chrome.storage.local.set({ accompanimentMode: enabled });
  sendSafe({ type: "SET_ACCOMPANIMENT", value: { enabled } });
});

// --- Ensure offscreen document exists ---
async function ensureOffscreen(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
    justification: "Tab audio capture via getUserMedia",
  });
}

ensureOffscreen();

// --- Connect button: trigger tabCapture flow ---
connectBtn.addEventListener("click", async () => {
  clearError();

  try {
    await ensureOffscreen();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showError("No active tab found");
      return;
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

    const sendWithRetry = (retries = 3) => {
      chrome.runtime.sendMessage({ type: "START_CAPTURE", streamId }, (response) => {
        if (chrome.runtime.lastError) {
          if (retries > 0) {
            setTimeout(() => sendWithRetry(retries - 1), 200);
            return;
          }
          showError(chrome.runtime.lastError.message ?? "Message failed");
          return;
        }
        if (response?.error) {
          showError(response.error);
          return;
        }
        setConnected(true);
        chrome.storage.local.set({ connected: true });

        chrome.storage.local.get(["pitch", "bypass", "preserveFormants", "accompanimentMode"], (data) => {
          if (typeof data.pitch === "number" && data.pitch !== 0) {
            sendSafe({ type: "SET_PITCH", value: { semitones: data.pitch } });
          }
          if (data.bypass === true) {
            sendSafe({ type: "SET_BYPASS", value: { active: true } });
          }
          if (data.preserveFormants === true) {
            sendSafe({ type: "SET_FORMANTS", value: { preserve: true } });
          }
          if (data.accompanimentMode === true) {
            sendSafe({ type: "SET_ACCOMPANIMENT", value: { enabled: true } });
          }
        });
      });
    };
    sendWithRetry();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
});

// --- Slider ---
slider.addEventListener("input", () => {
  const val = parseFloat(slider.value);
  display.innerHTML = `${formatSemitones(val)}<small>st</small>`;
  chrome.storage.local.set({ pitch: val });
  sendSafe({ type: "SET_PITCH", value: { semitones: val } });
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

// --- Bypass toggle (with Shift+click for debug mode) ---
bypassBtn.addEventListener("click", (e) => {
  if (e.shiftKey) {
    debugMode = !debugMode;
    abContainer.style.display = debugMode ? "block" : "none";
    console.log(`[A/B] Debug mode ${debugMode ? "ON" : "OFF"}`);
    return;
  }
  const isBypassed = bypassBtn.classList.toggle("bypassed");
  bypassBtn.textContent = isBypassed ? "Bypassed" : "Active";
  chrome.storage.local.set({ bypass: isBypassed });
  sendSafe({ type: "SET_BYPASS", value: { active: isBypassed } });
});

// --- A/B engine selection ---
btnA.addEventListener("click", () => {
  btnA.style.background = "#1b4332";
  btnA.style.color = "#40c057";
  btnB.style.background = "#1a1a2e";
  btnB.style.color = "#666";
  sendSafe({ type: "SET_ENGINE", engine: "signalsmith" });
});

btnB.addEventListener("click", () => {
  btnB.style.background = "#1b2a4a";
  btnB.style.color = "#6c9cff";
  btnA.style.background = "#1a1a2e";
  btnA.style.color = "#666";
  sendSafe({ type: "SET_ENGINE", engine: "rubberband" });
});

// --- Tab title ---
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const title = tabs[0]?.title ?? "No active tab";
  tabTitle.textContent = title;
});

// --- Connection state + restore values ---
chrome.storage.local.get(["connected", "pitch", "bypass", "snapToInteger", "preserveFormants", "accompanimentMode"], (data) => {
  const connected = data.connected === true;
  if (connected) {
    setConnected(true);
  } else {
    document.body.classList.add("disabled");
  }

  if (typeof data.pitch === "number") {
    slider.value = String(data.pitch);
    display.innerHTML = `${formatSemitones(data.pitch)}<small>st</small>`;
  }

  if (data.bypass === true) {
    bypassBtn.classList.add("bypassed");
    bypassBtn.textContent = "Bypassed";
  }

  const snap = data.snapToInteger !== false;
  snapCheckbox.checked = snap;
  applySnap(snap);

  formantCheckbox.checked = data.preserveFormants === true;
  accompanimentCheckbox.checked = data.accompanimentMode === true;
});
