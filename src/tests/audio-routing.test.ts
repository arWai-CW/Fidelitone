import { describe, expect, it } from "vitest";
import { effectiveEngine, engineGainValues } from "../offscreen/audio-routing";

const available = {
  signalsmithReady: true,
  signalsmithNode: {},
  rubberbandReady: true,
  rubberbandNode: {},
};

describe("offscreen audio routing", () => {
  it("prefers the selected available engine", () => {
    expect(effectiveEngine("signalsmith", available)).toBe("signalsmith");
    expect(effectiveEngine("rubberband", available)).toBe("rubberband");
  });

  it("falls back to the other initialized engine", () => {
    expect(effectiveEngine("signalsmith", { ...available, signalsmithNode: null })).toBe("rubberband");
    expect(effectiveEngine("rubberband", { ...available, rubberbandNode: null })).toBe("signalsmith");
  });

  it("keeps the selected engine when neither implementation is ready", () => {
    expect(effectiveEngine("signalsmith", {
      signalsmithReady: false,
      signalsmithNode: null,
      rubberbandReady: false,
      rubberbandNode: null,
    })).toBe("signalsmith");
  });

  it("expresses engine gains without coupling to AudioNodes", () => {
    expect(engineGainValues("signalsmith")).toEqual({ signalsmith: 1, rubberband: 0 });
    expect(engineGainValues("rubberband")).toEqual({ signalsmith: 0, rubberband: 1 });
  });
});
