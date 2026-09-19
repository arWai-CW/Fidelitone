import { describe, it, expect } from "vitest";
import { semitonesToPitchScale } from "../lib/dsp/math";

describe("semitonesToPitchScale", () => {
  it("0 semitones → pitchScale 1.0 (unison)", () => {
    expect(semitonesToPitchScale(0)).toBe(1.0);
  });

  it("12 semitones → pitchScale 2.0 (octave up)", () => {
    expect(semitonesToPitchScale(12)).toBe(2.0);
  });

  it("-12 semitones → pitchScale 0.5 (octave down)", () => {
    expect(semitonesToPitchScale(-12)).toBe(0.5);
  });

  it("7 semitones → pitchScale ≈ 1.498307 (perfect fifth)", () => {
    expect(semitonesToPitchScale(7)).toBeCloseTo(1.498307, 5);
  });

  it("0.5 semitones → pitchScale ≈ 1.029302 (cents)", () => {
    expect(semitonesToPitchScale(0.5)).toBeCloseTo(1.029302, 5);
  });

  it("24 semitones → pitchScale 4.0 (two octaves up)", () => {
    expect(semitonesToPitchScale(24)).toBe(4.0);
  });

  it("-24 semitones → pitchScale 0.25 (two octaves down)", () => {
    expect(semitonesToPitchScale(-24)).toBeCloseTo(0.25, 10);
  });

  it("fractional semitones are continuous", () => {
    const r1 = semitonesToPitchScale(1);
    const r2 = semitonesToPitchScale(2);
    const mid = semitonesToPitchScale(1.5);
    expect(mid).toBeGreaterThan(r1);
    expect(mid).toBeLessThan(r2);
  });
});
