// YouTube volume bridge — ISOLATED world (ADR-0005).
//
// This script owns `chrome.runtime` messaging with the popup and reads the
// page (volume / muted / paused) straight from the shared DOM. What it cannot
// do is see JavaScript the page defines: `#movie_player.setVolume()` exists in
// the page's world and reads as `undefined` here — the DOM node is shared, the
// page's JavaScript objects are not (verified in-browser). So every *write* is
// relayed to the MAIN-world writer (content-main.ts) over `window.postMessage`
// and acknowledged from there; a write that is never acknowledged reports a
// dead bridge instead of pretending it worked.

import { clampVolume, VOLUME_MAX } from "../lib/volume";

/** Channel marker shared with content-main.ts. */
const CHANNEL = "fidelitone-youtube-volume";
/** How long to wait for the MAIN-world writer before reporting a dead bridge. */
const ACK_TIMEOUT_MS = 1000;

interface TabMessageResponse {
  ok?: boolean;
  error?: string;
  found?: boolean;
  volume?: number;
  muted?: boolean;
}

function findVideo(): HTMLVideoElement | null {
  const element = document.querySelector("#movie_player video") ?? document.querySelector("video");
  return element instanceof HTMLVideoElement ? element : null;
}

/** The element's volume is 0–1; the panel speaks 0–100. */
function readVolume(video: HTMLVideoElement): number {
  return clampVolume(video.volume * VOLUME_MAX);
}

function describe(video: HTMLVideoElement): TabMessageResponse {
  return {
    ok: true,
    found: true,
    volume: readVolume(video),
    muted: video.muted,
  };
}

let requestId = 0;
const pending = new Map<number, (response: TabMessageResponse) => void>();

window.addEventListener("message", (event) => {
  // Same frame only, our channel only. The page can spoof both — worst case it
  // acks a volume change to itself, which it could do anyway.
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const msg = data as Record<string, unknown>;
  if (msg.source !== CHANNEL || msg.type !== "VOLUME_ACK") return;
  const id = typeof msg.id === "number" ? msg.id : null;
  if (id === null) return;
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve({ ok: msg.ok === true, error: typeof msg.error === "string" ? msg.error : undefined });
});

/** One round trip to the MAIN-world writer; times out into a visible error. */
function writeToPage(value: number): Promise<TabMessageResponse> {
  const id = ++requestId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "頁面音量控制未回應：重載擴充功能後，請重新載入此分頁" });
    }, ACK_TIMEOUT_MS);
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    window.postMessage({ source: CHANNEL, type: "VOLUME_SET", id, value }, "*");
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const msg = message as Record<string, unknown>;

  if (msg.type === "YT_VOLUME_GET") {
    const video = findVideo();
    sendResponse(video ? describe(video) : { ok: true, found: false });
    return false;
  }

  if (msg.type === "YT_VOLUME_SET") {
    if (typeof msg.value !== "number" || !Number.isFinite(msg.value)) {
      sendResponse({ ok: false, error: "音量數值無效" });
      return false;
    }
    if (!findVideo()) {
      sendResponse({ ok: false, error: "此頁面找不到影片" });
      return false;
    }
    void writeToPage(clampVolume(msg.value)).then(sendResponse);
    return true;
  }

  return false;
});
