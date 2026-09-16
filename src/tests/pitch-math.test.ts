import { describe, it, expect } from "vitest";

/**
 * Pitch-to-ratio formula: Math.pow(2.0, halfSteps / 12.0)
 * Pure math tests — no source imports needed.
 */
function halfStepsToRatio(halfSteps: number): number {
  return Math.pow(2.0, halfSteps / 12.0);
}

describe("halfStepsToRatio", () => {
  it("0 half-steps → ratio 1.0 (unison)", () => {
    expect(halfStepsToRatio(0)).toBe(1.0);
  });

  it("12 half-steps → ratio 2.0 (octave up)", () => {
    expect(halfStepsToRatio(12)).toBe(2.0);
  });

  it("-12 half-steps → ratio 0.5 (octave down)", () => {
    expect(halfStepsToRatio(-12)).toBe(0.5);
  });

  it("7 half-steps → ratio ≈ 1.498307 (perfect fifth)", () => {
    expect(halfStepsToRatio(7)).toBeCloseTo(1.498307, 5);
  });

  it("0.5 half-steps → ratio ≈ 1.029302 (cents)", () => {
    expect(halfStepsToRatio(0.5)).toBeCloseTo(1.029302, 5);
  });

  it("24 half-steps → ratio 4.0 (two octaves up)", () => {
    expect(halfStepsToRatio(24)).toBe(4.0);
  });

  it("-24 half-steps → ratio 0.25 (two octaves down)", () => {
    expect(halfStepsToRatio(-24)).toBeCloseTo(0.25, 10);
  });

  it("fractional half-steps are continuous", () => {
    const r1 = halfStepsToRatio(1);
    const r2 = halfStepsToRatio(2);
    const mid = halfStepsToRatio(1.5);
    expect(mid).toBeGreaterThan(r1);
    expect(mid).toBeLessThan(r2);
  });
});
