// Offscreen audio engine — composition root.
// Responsibilities are delegated to AudioGraph, EngineSwitching,
// AccompanimentGraph, CaptureManager and GraphRouter so each
// module has a small interface and deep implementation.

import { registerOffscreenMessages } from "./offscreen-messages";
import { OffscreenController } from "./offscreen-controller";

const controller = new OffscreenController();

registerOffscreenMessages(controller);

console.log("[offscreen] Message listener registered");
void controller.start().catch((err) =>
  console.error("[offscreen] Initial graph setup failed:", err),
);
