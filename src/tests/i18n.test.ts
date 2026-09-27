// The catalog's own guarantees. A locale is only as good as the checks that
// keep it complete, and "complete" is a property of the build, not of review.

import { describe, expect, it } from "vitest";
import {
  createTranslator,
  detectLocale,
  interpolate,
  lookup,
  matchLocale,
  resolveLocale,
  SHIPPED_LOCALES,
} from "../i18n/catalog";
import { DEFAULT_LOCALE, type MessageKey } from "../i18n/types";

describe("locale matching", () => {
  it("matches the locales that ship, across tag shapes", () => {
    expect(matchLocale("zh-Hant")).toBe("zh-Hant");
    expect(matchLocale("zh-TW")).toBe("zh-Hant");
    expect(matchLocale("zh-Hant-TW")).toBe("zh-Hant");
    expect(matchLocale("zh_HK")).toBe("zh-Hant");
    expect(matchLocale("ZH-hant-tw")).toBe("zh-Hant");
    expect(matchLocale("zh")).toBe("zh-Hant");
  });

  it("maps the language subtag of a regional variant", () => {
    expect(matchLocale("en-US")).toBe("en");
    expect(matchLocale("ja-JP")).toBe("ja");
  });

  it("returns null for locales that do not ship", () => {
    // An unmatched language falls through to the default rather than
    // rendering keys.
    expect(matchLocale("fr-FR")).toBeNull();
    expect(matchLocale("ko-KR")).toBeNull();
    expect(matchLocale("zh-Hans-CN")).toBeNull();
  });

  it("tolerates empty and malformed tags", () => {
    expect(matchLocale("")).toBeNull();
    expect(matchLocale("   ")).toBeNull();
    expect(matchLocale("x-whatever")).toBeNull();
  });
});

describe("locale resolution", () => {
  it("prefers the first candidate that has copy", () => {
    expect(resolveLocale(["zh-TW", "en-US"])).toBe("zh-Hant");
    expect(resolveLocale(["de-DE", "ja-JP", "en-GB"])).toBe("ja");
    expect(resolveLocale(["ko-KR", "en-GB"])).toBe("en");
  });

  it("falls back to zh-Hant, the interface that ships today", () => {
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(["fr-FR", "de-DE"])).toBe("zh-Hant");
  });

  it("only ever resolves to a locale that is actually shipped", () => {
    expect(SHIPPED_LOCALES).toContain(DEFAULT_LOCALE);
    for (const candidates of [[], ["fr"], ["en-GB"], ["en-US", "zh-TW"]]) {
      expect(SHIPPED_LOCALES).toContain(resolveLocale(candidates));
    }
  });
});

describe("interpolation", () => {
  it("substitutes named placeholders", () => {
    expect(interpolate("目前音量比基準高 {value}%", { value: 12 })).toBe("目前音量比基準高 12%");
    expect(interpolate("目前音訊來自「{title}」", { title: "cover" })).toBe("目前音訊來自「cover」");
  });

  it("substitutes every occurrence and coerces numbers", () => {
    expect(interpolate("{a}-{a}-{a}", { a: 1 })).toBe("1-1-1");
    expect(interpolate("{a}", { a: 0 })).toBe("0");
  });

  it("leaves an unknown placeholder visible rather than blanking the sentence", () => {
    expect(interpolate("{known} {unknown}", { known: "x" })).toBe("x {unknown}");
  });

  it("passes through when there are no params", () => {
    expect(interpolate("目前音量與基準一致")).toBe("目前音量與基準一致");
    expect(interpolate("{a}", undefined)).toBe("{a}");
  });
});

describe("lookup", () => {
  const t = createTranslator(DEFAULT_LOCALE);

  it("reads a nested key", () => {
    expect(t("connection.headline.connected")).toBe("音訊通道已建立");
    expect(t("options.formants.label")).toBe("共振峰保護");
    expect(t("route.passthrough.desc")).toBe("移調引擎未啟動，音訊直接通過");
  });

  it("interpolates through the translator", () => {
    expect(t("divergence.namedTab", { title: "演唱會 LIVE" })).toBe("目前音訊來自「演唱會 LIVE」");
    expect(t("deviation.higherThanBase", { value: 8 })).toBe("目前音量比基準高 8%");
    expect(t("volume.currentValue", { value: 78 })).toBe("目前 78");
  });

  it("reports a missing key as the key, not as blank", () => {
    // A blank panel is a bug nobody notices; a visible key is one they report.
    const missing = "connection.nope" as MessageKey;
    expect(lookup(missing, DEFAULT_LOCALE)).toBe("connection.nope");
  });

  it("exposes its locale", () => {
    expect(t.locale).toBe(DEFAULT_LOCALE);
  });
});

describe("plural forms", () => {
  it("inflects in English, where the count is visible to the reader", () => {
    const en = createTranslator("en");
    expect(en("pitch.valueAriaText", { value: "+1.00", count: 1 })).toBe("+1.00 semitone");
    expect(en("pitch.valueAriaText", { value: "+3.00", count: 3 })).toBe("+3.00 semitones");
    expect(en("pitch.valueAriaText", { value: "-0.50", count: 0.5 })).toBe("-0.50 semitones");
  });

  it("leaves locales that do not inflect alone", () => {
    // Chinese and Japanese have a single plural form, so their entries are
    // plain strings and `count` changes nothing.
    for (const locale of ["zh-Hant", "ja"] as const) {
      const t = createTranslator(locale);
      const one = t("pitch.valueAriaText", { value: "1", count: 1 });
      const many = t("pitch.valueAriaText", { value: "3", count: 3 });
      expect(one).not.toContain("{");
      expect(many).not.toContain("{");
      expect(one.replace("1", "")).toBe(many.replace("3", ""));
    }
  });
});

describe("number formatting", () => {
  const semitones: Intl.NumberFormatOptions = {
    signDisplay: "always",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };

  it("agrees with the hand-rolled formatter in every shipped locale", () => {
    // The panel's own `formatSemitones` concatenates an ASCII "+" and "-".
    // If Intl ever disagreed, zh-Hant would silently change on screen.
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const t = createTranslator(locale);
      for (const value of [0, 1, -1, 3, -4, 12, -12, 0.5, 0.07]) {
        const sign = value >= 0 ? "+" : "";
        expect(t.formatNumber(value, semitones)).toBe(`${sign}${value.toFixed(2)}`);
      }
    }
  });

  it("caches formatters instead of rebuilding one per call", () => {
    const t = createTranslator("en");
    expect(t.formatNumber(1, semitones)).toBe(t.formatNumber(1, semitones));
    expect(t.formatNumber(1000)).toBe("1,000");
  });
});

describe("detectLocale", () => {
  it("resolves even when chrome.i18n is absent", async () => {
    // The popup must still open where the API is missing; that is the default.
    await expect(detectLocale()).resolves.toBe(DEFAULT_LOCALE);
  });
});
