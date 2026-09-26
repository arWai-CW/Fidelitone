// Offscreen audio engine — composition root.
// Responsibilities are delegated to AudioGraph, EngineSwitching,
// AccompanimentGraph, CaptureManager and GraphRouter so each
// module has a small interface and deep implementation.

import { registerOffscreenMessages } from "./offscreen-messages";
import { OffscreenController } from "./offscreen-controller";
import type { CaptureEvent } from "./offscreen-state";

/** Pushes capture liveness/identity to the service worker (ADR-0004). */
function publishCaptureEvent(event: CaptureEvent): void {
  try {
    chrome.runtime.sendMessage({ type: "CAPTURE_EVENT", ...event }, () => {
      void chrome.runtime.lastError;
    });
  } catch (err) {
    // No listener yet (service worker starting); badge catches up on reconcile.
    console.debug("[offscreen] CAPTURE_EVENT not delivered:", err);
  }
}

const controller = new OffscreenController({ onCaptureEvent: publishCaptureEvent });

registerOffscreenMessages(controller);

console.log("[offscreen] Message listener registered");
void controller.start().catch((err) =>
  console.error("[offscreen] Initial graph setup failed:", err),
);
