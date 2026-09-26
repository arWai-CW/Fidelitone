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

  it("selects bypass before accompaniment and the engine route", () => {
    expect(routeFor({
      bypass: true,
      accompanimentMode: true,
      accompanimentReady: true,
      engineReady: true,
    })).toBe("bypass");
    expect(routeFor({
      bypass: false,
      accompanimentMode: true,
      accompanimentReady: true,
      engineReady: true,
    })).toBe("accompaniment");
    expect(routeFor({
      bypass: false,
      accompanimentMode: false,
      accompanimentReady: true,
      engineReady: true,
    })).toBe("signalsmith");
  });

  // ADR-0007: accompaniment asked for but not ready must not claim the
  // accompaniment route, and a dead engine must report passthrough rather than
  // a route that sounds processed but is not.
  it("reports passthrough when the engine is not up", () => {
    expect(routeFor({
      bypass: false,
      accompanimentMode: false,
      accompanimentReady: false,
      engineReady: false,
    })).toBe("passthrough");
  });

  it("falls back to the engine when accompaniment is asked for but not ready", () => {
    expect(routeFor({
      bypass: false,
      accompanimentMode: true,
      accompanimentReady: false,
      engineReady: true,
    })).toBe("signalsmith");
  });
});
