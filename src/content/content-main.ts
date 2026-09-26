// YouTube volume writer — MAIN world (ADR-0005).
//
// Runs in the page's own world because that is the only place YouTube's player
// API is visible: `#movie_player.setVolume()` / `unMute()` are JavaScript
// defined by the page, and the same DOM node reports them as `undefined` from
// an isolated world (verified in-browser). Driving volume through the player
// API is what keeps the native slider and mute icon in step; writing
// `video.volume` directly changes the audio and nothing else. The property
// remains the fallback for when the player API is not there (player not ready
// yet, or a page without `#movie_player`).
//
// Receives its instructions from the isolated bridge (content.ts) via
// window.postMessage and acknowledges each one; the ramp then continues in the
// background at its own pace.

import { clampVolume, rampVolume, VOLUME_MAX } from "../lib/volume";

/** Channel marker shared with content.ts. */
const CHANNEL = "fidelitone-youtube-volume";
/** Duration of every volume change; see ADR-0005 (Q20–Q23). */
const RAMP_MS = 500;

interface YoutubePlayerApi {
  setVolume?: (volume: number) => void;
  unMute?: () => void;
}

function playerApi(): YoutubePlayerApi | null {
  const element = document.getElementById("movie_player");
  return element ? (element as YoutubePlayerApi) : null;
}

function findVideo(): HTMLVideoElement | null {
  const element = document.querySelector("#movie_player video") ?? document.querySelector("video");
  return element instanceof HTMLVideoElement ? element : null;
}

/** The element's volume is 0–1; the panel speaks 0–100. */
function readVolume(video: HTMLVideoElement): number {
  return clampVolume(video.volume * VOLUME_MAX);
}

/** Single write path for every volume change: player API, property as fallback. */
function applyVolume(video: HTMLVideoElement, percent: number): void {
  const value = clampVolume(percent);
  const api = playerApi();
  if (typeof api?.setVolume === "function") {
    // The native slider only represents whole percents; rounding keeps each
    // ramp step on a value the UI can actually display.
    api.setVolume(Math.round(value));
    return;
  }
  video.volume = value / VOLUME_MAX;
}

function unmute(video: HTMLVideoElement): void {
  const api = playerApi();
  if (typeof api?.unMute === "function") api.unMute();
  else video.muted = false;
}

let rampToken = 0;
let rampFrame: number | null = null;

/** dB-linear ramp from wherever the element is right now; retargets any run in flight. */
function rampTo(video: HTMLVideoElement, target: number): void {
  const from = readVolume(video);
  const to = clampVolume(target);
  const token = ++rampToken;
  if (rampFrame !== null) cancelAnimationFrame(rampFrame);

  if (from === to) {
    applyVolume(video, to);
    rampFrame = null;
    return;
  }

  const startedAt = performance.now();
  const step = () => {
    // A newer command invalidates this run: the last instruction wins.
    if (token !== rampToken) return;
    const progress = (performance.now() - startedAt) / RAMP_MS;
    applyVolume(video, rampVolume(from, to, progress));
    if (progress < 1) {
      rampFrame = requestAnimationFrame(step);
    } else {
      applyVolume(video, to);
      rampFrame = null;
    }
  };
  rampFrame = requestAnimationFrame(step);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const msg = data as Record<string, unknown>;
  if (msg.source !== CHANNEL || msg.type !== "VOLUME_SET") return;
  if (typeof msg.id !== "number") return;

  let ok = false;
  let error: string | undefined;
  if (typeof msg.value !== "number" || !Number.isFinite(msg.value)) {
    error = "音量數值無效";
  } else {
    const video = findVideo();
    if (!video) {
      error = "此頁面找不到影片";
    } else {
      const target = clampVolume(msg.value);
      // Setting a volume is an explicit intent to hear something: follow
      // YouTube's own slider and lift the mute when the target is audible.
      if (target > 0) unmute(video);
      rampTo(video, target);
      ok = true;
    }
  }

  // Acknowledged as *accepted*: the 500 ms ramp then runs at its own pace.
  window.postMessage({ source: CHANNEL, type: "VOLUME_ACK", id: msg.id, ok, error }, "*");
});
