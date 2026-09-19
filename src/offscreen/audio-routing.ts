import type { Engine } from "./offscreen-state";

export interface EngineStatus {
  signalsmithReady: boolean;
  signalsmithNode: unknown;
  rubberbandReady: boolean;
  rubberbandNode: unknown;
}

export function effectiveEngine(active: Engine, status: EngineStatus): Engine {
  if (active === "signalsmith" && status.signalsmithReady && status.signalsmithNode) {
    return "signalsmith";
  }
  if (active === "rubberband" && status.rubberbandReady && status.rubberbandNode) {
    return "rubberband";
  }
  if (status.signalsmithReady && status.signalsmithNode) return "signalsmith";
  if (status.rubberbandReady && status.rubberbandNode) return "rubberband";
  return active;
}

export function engineGainValues(engine: Engine): { signalsmith: number; rubberband: number } {
  return {
    signalsmith: engine === "signalsmith" ? 1 : 0,
    rubberband: engine === "rubberband" ? 1 : 0,
  };
}
