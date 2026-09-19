import { describe, expect, it } from "vitest";
import {
  ACCOMPANIMENT_ALIGN_DELAY_S,
  CROSSOVER_FREQ,
  routeFor,
} from "../offscreen/offscreen-state";

describe("offscreen audio constants and route", () => {
  it("keeps the ADR-0001 crossover and alignment values", () => {
    expect(CROSSOVER_FREQ).toBe(175);
    expect(ACCOMPANIMENT_ALIGN_DELAY_S).toBe(0.09);
  });

  it("selects bypass before accompaniment and engine routes", () => {
    expect(routeFor({
      bypass: true,
      accompanimentMode: true,
      accompanimentReady: true,
      engine: "signalsmith",
    })).toBe("bypass");
    expect(routeFor({
      bypass: false,
      accompanimentMode: true,
      accompanimentReady: true,
      engine: "signalsmith",
    })).toBe("accompaniment");
    expect(routeFor({
      bypass: false,
      accompanimentMode: false,
      accompanimentReady: true,
      engine: "rubberband",
    })).toBe("rubberband");
  });
});
