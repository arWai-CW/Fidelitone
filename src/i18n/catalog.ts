// Catalog lookup and locale resolution.
//
// Deliberately free of the DOM and of chrome.*: every export is a pure function
// over its arguments, so it runs in the same node environment as the rest of
// src/tests/ and behaves identically wherever it is called from. The one place
// that touches the document lives in dom.ts.

import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhHant from "./locales/zh-Hant.json";
import {
  DEFAULT_LOCALE,
  type Dictionary,
  type Locale,
  type MessageKey,
  type MessageParams,
  type MessageLeaf,
  type PluralForms,
} from "./types";

/**
 * Locales that actually have a dictionary. This map, not a list of intentions,
 * is what resolution consults — so a locale cannot be resolved to before it has
 * copy, and a half-finished translation shows up as a compile error here rather
 * than as keys in front of a user.
 */
const DICTIONARIES: Partial<Record<Locale, Dictionary>> = {
  en: en as Dictionary,
  "zh-Hant": zhHant as Dictionary,
  ja: ja as Dictionary,
};

/** Every locale this build can render, in the order resolution considers them. */
export const SHIPPED_LOCALES = Object.keys(DICTIONARIES) as Locale[];

/** A locale tag → a locale this build ships. Only shipped locales appear here. */
const LOCALE_ALIASES: Partial<Record<string, Locale>> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  "zh-hant": "zh-Hant",
  "zh-hant-tw": "zh-Hant",
  "zh-hant-hk": "zh-Hant",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-mo": "zh-Hant",
  zh: "zh-Hant",
  ja: "ja",
  "ja-jp": "ja",
  jp: "ja",
};

/** `zh-Hant-TW`, `en_US`, `JA` → a shipped locale, or null if there is no match. */
export function matchLocale(tag: string): Locale | null {
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  const direct = LOCALE_ALIASES[normalized];
  if (direct) return direct;
  // `zh-Hant-HK` or `zh-TW-Hant`: keep the script, drop the region.
  const parts = normalized.split("-");
  if (parts.length > 1) {
    const trimmed = LOCALE_ALIASES[parts.slice(0, -1).join("-")];
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Picks the first candidate this build has copy for, defaulting to zh-Hant.
 *
 * Order matters and is a product decision, not an implementation detail: the
 * user's browsing languages come first, then the browser's UI language. That
 * ordering is what keeps a Mandarin speaker running an English browser on the
 * interface they had before this shipped in English. Swapping the first two is
 * a one-line change that flips that trade.
 */
export function resolveLocale(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    const matched = matchLocale(candidate);
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}

/** Asks the browser. Never throws: a popup that fails to open helps nobody. */
export async function detectLocale(): Promise<Locale> {
  const candidates: string[] = [];
  try {
    // Chrome 99+. The user's preferred languages, which is not the same thing
    // as the browser's UI language.
    const accepted = await chrome.i18n.getAcceptLanguages();
    if (Array.isArray(accepted)) candidates.push(...accepted);
  } catch {
    // Not present on this surface, or not promise-capable.
  }
  try {
    const ui = chrome.i18n.getUILanguage();
    if (ui) candidates.push(ui);
  } catch {
    // No chrome.i18n at all; the default below covers it.
  }
  return resolveLocale(candidates);
}

/** Substitutes `{name}` placeholders. An unknown name is left visible. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

function readPath(dictionary: unknown, key: string): unknown {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const pluralRules: Partial<Record<Locale, Intl.PluralRules>> = {};

/**
 * Picks a plural form, falling back to `other` for any category a locale has not
 * translated. English needs `one`; Chinese and Japanese only ever need `other`,
 * which is why their entries can stay plain strings.
 */
function selectForm(node: MessageLeaf, count: number, locale: Locale): string {
  if (typeof node === "string") return node;
  const rules = (pluralRules[locale] ??= new Intl.PluralRules(locale));
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> = node;
  return forms[rules.select(count)] ?? node.other;
}

/** Looks a key up, falling back to the default locale, then to the key itself. */
export function lookup(key: MessageKey, locale: Locale, count?: number): string {
  const found = readPath(DICTIONARIES[locale], key);
  if (isLeaf(found)) {
    if (count === undefined) return selectForm(found, 0, locale);
    return selectForm(found, count, locale);
  }
  const fallback = readPath(DICTIONARIES[DEFAULT_LOCALE], key);
  if (isLeaf(fallback)) {
    if (count === undefined) return selectForm(fallback, 0, locale);
    return selectForm(fallback, count, locale);
  }
  // Returning the key makes a missing message visible instead of blank, which
  // is the difference between noticing it and shipping an empty panel.
  return key;
}

function isLeaf(node: unknown): node is MessageLeaf {
  if (typeof node === "string") return true;
  return typeof node === "object" && node !== null && typeof (node as PluralForms).other === "string";
}

export interface Translator {
  (key: MessageKey, params?: MessageParams): string;
  /**
   * `formatNumber` applies the locale's sign, separator, and digit conventions.
   * It exists so the pitch readout and the volume panel cannot disagree about
   * how a number looks in the language currently on screen.
   */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  readonly locale: Locale;
}

/** Builds a `t` bound to a locale. Cheap enough to call on every render. */
export function createTranslator(locale: Locale): Translator {
  const numberFormats = new Map<string, Intl.NumberFormat>();

  const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string => {
    const key = JSON.stringify(options ?? null);
    let format = numberFormats.get(key);
    if (!format) {
      format = new Intl.NumberFormat(locale, options);
      numberFormats.set(key, format);
    }
    return format.format(value);
  };

  const translate = ((key: MessageKey, params?: MessageParams) => {
    const count = typeof params?.count === "number" ? params.count : undefined;
    return interpolate(lookup(key, locale, count), params);
  }) as {
    (key: MessageKey, params?: MessageParams): string;
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
    locale: Locale;
  };
  translate.formatNumber = formatNumber;
  translate.locale = locale;
  return translate as Translator;
}
