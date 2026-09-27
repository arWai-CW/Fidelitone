// The catalog's type surface.
//
// zh-Hant.json is the single source of truth: it defines which keys exist, and
// every other locale is checked against its shape at compile time. A missing
// key is a build error, not an empty string in a popup — an empty string is
// indistinguishable from a bug that has already shipped.

import zhHant from "./locales/zh-Hant.json";

type Join<K extends string, P extends string> = P extends "" ? K : `${P}.${K}`;

/**
 * The CLDR plural categories a locale may need. `other` is required because
 * every language has it; `one` exists so English can say "1 semitone" instead
 * of "1 semitones". Locales that do not inflect (Chinese, Japanese) leave a
 * plain string in the catalog and never touch this.
 */
export interface PluralForms {
  other: string;
  one?: string;
}

/** What a catalog leaf may hold: a fixed string, or a set of plural forms. */
export type MessageLeaf = string | PluralForms;

type IsLeaf<T> = T extends string ? true : T extends PluralForms ? true : false;

/** Dotted paths to every leaf, e.g. `connection.button.label.connect`. */
export type MessageKey = {
  [K in keyof typeof zhHant & string]: IsLeaf<(typeof zhHant)[K]> extends true
    ? Join<K, "">
    : MessageKeysOf<(typeof zhHant)[K], Join<K, "">>;
}[keyof typeof zhHant & string];

type MessageKeysOf<T, P extends string> = {
  [K in keyof T & string]: IsLeaf<T[K]> extends true
    ? Join<K, P>
    : MessageKeysOf<T[K], Join<K, P>>;
}[keyof T & string];

/**
 * The shape every other locale must match. Leaves widen to `MessageLeaf` rather
 * than the source's literal type, so a translation is free to be any string —
 * including plural forms where the source had none. The nesting is what must be
 * identical.
 */
export type CatalogShape = {
  [K in keyof typeof zhHant]: IsLeaf<(typeof zhHant)[K]> extends true
    ? MessageLeaf
    : CatalogShapeOf<(typeof zhHant)[K]>;
};

type CatalogShapeOf<T> = {
  [K in keyof T]: IsLeaf<T[K]> extends true ? MessageLeaf : CatalogShapeOf<T[K]>;
};

/** Values interpolated into a message, keyed by placeholder name. */
export type MessageParams = Record<string, string | number>;

/** One locale's full dictionary: the catalog's shape with message leaves. */
export type Dictionary = CatalogShape;

/** A locale this project maintains copy for. */
export type Locale = "en" | "zh-Hant" | "ja";

/**
 * The locale used when nothing else matches, and the one every other locale
 * falls back to for a missing key. It is also the interface that ships today,
 * so an unmatched browser language lands on zh-Hant rather than on English.
 */
export const DEFAULT_LOCALE: Locale = "zh-Hant";
