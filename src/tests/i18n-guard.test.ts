// Repo-level guards on the catalog itself.
//
// These read files off disk rather than importing them, because what they check
// is not behaviour but discipline: that no user-visible string crept back into
// the popup, that no icon lost its icon, and that no locale drifted out of
// shape. Each one is the failure that is easy to introduce and expensive to
// notice, which is the only kind of test worth adding for a three-locale catalog.

import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ja from "../i18n/locales/ja.json";
import zhHant from "../i18n/locales/zh-Hant.json";
import { SHIPPED_LOCALES } from "../i18n/catalog";
import type { Dictionary, Locale } from "../i18n/types";
import POPUP_HTML from "../popup/popup.html?raw";
import POPUP_TS from "../popup/popup.ts?raw";

/** CJK ideographs, kana, and the fullwidth forms that carry zh/ja copy. */
const CJK = /[　-〿぀-ゟ゠-ヿ一-鿿＀-￯]/;

/* ------------------------------------------------------------------ keys */

/** Every string leaf in a dictionary, as dotted paths. */
function keysOf(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (typeof node === "object" && node !== null && "other" in (node as object)) {
    // A plural group is a leaf for key-parity purposes.
    return [prefix];
  }
  if (typeof node === "object" && node !== null) {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      keysOf(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

/* ------------------------------------------------------------------ HTML */

/** Which DOM attribute each marker attribute writes to; `null` means text. */
const ATTR_TARGET: Record<string, string | null> = {
  "data-i18n": null,
  "data-i18n-aria": "aria-label",
  "data-i18n-title": "title",
  "data-i18n-tooltip": "data-tooltip",
};
const DATA_ATTRS = Object.keys(ATTR_TARGET);
const VOID_ELEMENTS = new Set(["input", "img", "br", "hr", "meta", "link"]);

interface MarkedElement {
  key: string;
  attr: string;
  tag: string;
  /** The element's own inner HTML. */
  inner: string;
  /** The full opening tag, for attribute comparisons. */
  openTag: string;
}

/** The body of the element whose opening tag ends at `start`, balancing nesting. */
function innerOf(html: string, tag: string, start: number): string {
  const openRe = new RegExp(`<${tag}(?=[\\s>/])`, "g");
  const closeTag = `</${tag}>`;
  let depth = 1;
  let cursor = start;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = html.indexOf(closeTag, cursor);
    if (nextClose === -1) return html.slice(start);
    if (nextOpen !== null && nextOpen.index < nextClose) {
      depth++;
      cursor = nextOpen.index;
    } else {
      depth--;
      if (depth === 0) return html.slice(start, nextClose);
      cursor = nextClose + closeTag.length;
    }
  }
  return "";
}

function markedElements(html: string): MarkedElement[] {
  const out: MarkedElement[] = [];
  const re = /<([a-zA-Z][\w-]*)((?:\s[^>]*?)?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [full, tag, attrs] = m;
    for (const attr of DATA_ATTRS) {
      const keyMatch = new RegExp(`${attr}="([^"]+)"`).exec(attrs ?? "");
      if (!keyMatch) continue;
      const inner = VOID_ELEMENTS.has(tag) ? "" : innerOf(html, tag, m.index + full.length);
      out.push({ key: keyMatch[1], attr, tag, inner, openTag: full });
      break;
    }
  }
  return out;
}

const MARKED = markedElements(POPUP_HTML);

/** Every key the catalog can resolve, as a flat set. */
const SOURCE_KEYS = new Set(keysOf(zhHant));

/* ------------------------------------------------------------------ tests */

describe("catalog shape", () => {
  it("ships every locale the plan promises", () => {
    expect([...SHIPPED_LOCALES].sort()).toEqual(["en", "ja", "zh-Hant"]);
  });

  it("has no orphan keys in any locale", () => {
    // TypeScript cannot catch these: an imported JSON value is not a fresh
    // object literal, so an extra key slides past the shape check.
    const dictionaries: Record<Locale, Dictionary> = { en, ja, "zh-Hant": zhHant } as never;
    for (const locale of SHIPPED_LOCALES) {
      const orphans = keysOf(dictionaries[locale]).filter((k) => !SOURCE_KEYS.has(k));
      expect(orphans, `${locale} has keys zh-Hant does not`).toEqual([]);
    }
  });

  it("has no missing keys in any locale", () => {
    // The mirror of the check above, and the one that matters most: a missing
    // key renders as a fallback, not as a failure, at runtime.
    const dictionaries: Record<Locale, Dictionary> = { en, ja, "zh-Hant": zhHant } as never;
    for (const locale of SHIPPED_LOCALES) {
      const missing = keysOf(zhHant).filter((k) => !keysOf(dictionaries[locale]).includes(k));
      expect(missing, `${locale} is missing keys`).toEqual([]);
    }
  });
});

describe("popup copy discipline", () => {
  it("keeps user-visible strings out of popup.ts", () => {
    // Every literal the popup writes has to come from the catalog, or one
    // language silently keeps a language the others lost. Comments may be in
    // any language, which is why they are stripped first.
    const withoutComments = POPUP_TS
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const offenders = withoutComments
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => {
        const literals = line.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? [];
        return literals.some((l) => CJK.test(l));
      })
      .map(([n, line]) => `popup.ts:${n}  ${line.trim()}`);
    expect(offenders, "these literals are not in the catalog").toEqual([]);
  });

  it("never marks an element that has children with data-i18n", () => {
    // data-i18n assigns textContent. On an element holding an <svg> or a span
    // that deletes the child, which is how the six icon buttons lost their
    // icons once already.
    const offenders = MARKED.filter(
      (el) => el.attr === "data-i18n" && /<[a-zA-Z]/.test(el.inner),
    ).map((el) => `${el.attr}="${el.key}" on <${el.tag}> which has children`);
    expect(offenders).toEqual([]);
  });

  it("only references keys the catalog can resolve", () => {
    const unknown = MARKED.filter((el) => !SOURCE_KEYS.has(el.key)).map((el) => el.key);
    expect(unknown).toEqual([]);
  });
});

describe("pre-script fallback", () => {
  it("renders the zh-Hant value in the markup, so it cannot go stale", () => {
    // popup.html carries the default-language copy as a fallback for the frame
    // before popup.ts runs. If these drift from the catalog, the panel flashes
    // one language and then settles on another.
    const source = zhHant as Record<string, unknown>;
    const read = (key: string): string => {
      const node = key.split(".").reduce<unknown>((acc, part) => (acc as never)?.[part], source);
      if (node && typeof node === "object" && "other" in node) {
        return String((node as { other: string }).other);
      }
      return String(node);
    };
    const drift: string[] = [];
    for (const el of MARKED) {
      const expected = read(el.key);
      const name = ATTR_TARGET[el.attr];
      if (name === null) {
        const text = el.inner.replace(/<[^>]*>/g, "").trim();
        if (text !== expected) {
          drift.push(`${el.key}: markup ${JSON.stringify(text)} vs catalog ${JSON.stringify(expected)}`);
        }
        continue;
      }
      const actual = new RegExp(`${name}="([^"]*)"`).exec(el.openTag)?.[1];
      if (actual !== expected) {
        drift.push(`${el.key}: ${name}=${JSON.stringify(actual)} vs catalog ${JSON.stringify(expected)}`);
      }
    }
    expect(drift).toEqual([]);
  });
});
