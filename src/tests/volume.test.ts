import { describe, expect, it } from "vitest";
import {
  clampVolume,
  rampVolume,
  volumeDeltaPercent,
} from "../lib/volume";

describe("volume scale", () => {
  it("clamps to 0–100 and treats unusable numbers as silence", () => {
    expect(clampVolume(-10)).toBe(0);
    expect(clampVolume(42.6)).toBe(42.6);
    expect(clampVolume(250)).toBe(100);
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("volumeDeltaPercent", () => {
  it("reports the signed difference relative to the base", () => {
    expect(volumeDeltaPercent(80, 100)).toBe(-20);
    expect(volumeDeltaPercent(50, 50)).toBe(0);
    expect(volumeDeltaPercent(60, 50)).toBe(20);
    expect(volumeDeltaPercent(40, 50)).toBe(-20);
    // Inputs clamp to the 0–100 scale first: an above-scale current lands on 100.
    expect(volumeDeltaPercent(120, 100)).toBe(0);
    expect(volumeDeltaPercent(110, 50)).toBe(100);
  });

  it("rounds to whole percents so a near-match reads as consistent", () => {
    expect(volumeDeltaPercent(45.2, 45)).toBe(0);
    expect(volumeDeltaPercent(45.6, 45)).toBe(1);
  });

  it("has no relative scale against a base of zero or unusable input", () => {
    expect(volumeDeltaPercent(50, 0)).toBe(0);
    expect(volumeDeltaPercent(50, Number.NaN)).toBe(0);
    expect(volumeDeltaPercent(Number.NaN, 100)).toBe(0);
    expect(volumeDeltaPercent(-5, 100)).toBe(-100);
  });
});

describe("rampVolume", () => {
  it("holds the endpoints and interpolates in dB", () => {
    expect(rampVolume(50, 100, 0)).toBe(50);
    expect(rampVolume(50, 100, 1)).toBe(100);
    // dB-linear: halfway in dB is ×√2, not the arithmetic mean
    expect(rampVolume(50, 100, 0.5)).toBeCloseTo(70.7107, 3);
    expect(rampVolume(100, 50, 0.5)).toBeCloseTo(70.7107, 3);
  });

  it("clamps progress and inputs", () => {
    expect(rampVolume(50, 100, -1)).toBe(50);
    expect(rampVolume(50, 100, 2)).toBe(100);
    expect(rampVolume(50, 100, Number.NaN)).toBe(100);
    // Inputs are clamped first, so −20 → 0 starts on the linear-to-silence path.
    expect(rampVolume(-20, 120, 0.5)).toBe(50);
  });

  it("falls back to linear whenever a leg ends at silence", () => {
    expect(rampVolume(0, 50, 0.5)).toBe(25);
    expect(rampVolume(50, 0, 0.5)).toBe(25);
    expect(rampVolume(50, 0, 1)).toBe(0);
  });
});
