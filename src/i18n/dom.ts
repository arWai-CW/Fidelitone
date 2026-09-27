// The one place the catalog touches the document.
//
// Static copy lives in popup.html as `data-i18n` / `data-i18n-aria` rather than
// being written by script, so a panel whose script has not run yet still shows a
// complete interface instead of a skeleton of empty boxes.

import type { Translator } from "./catalog";
import type { MessageKey } from "./types";

/**
 * Sets every `[data-i18n]` to its text, `[data-i18n-aria]` to its aria-label,
 * `[data-i18n-title]` to its title, and `[data-i18n-tooltip]` to the custom
 * `data-tooltip` the tooltip layer reads.
 *
 * `data-i18n` assigns textContent, so it must only go on elements whose content
 * is text. An icon button holding an `<svg>` uses `data-i18n-tooltip` and
 * `data-i18n-aria` instead — marking it `data-i18n` would delete the icon.
 */
export function applyStaticMessages(root: ParentNode, t: Translator): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n as MessageKey | undefined;
    if (key) element.textContent = t(key);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
    const key = element.dataset.i18nAria as MessageKey | undefined;
    if (key) element.setAttribute("aria-label", t(key));
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const key = element.dataset.i18nTitle as MessageKey | undefined;
    if (key) element.title = t(key);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-tooltip]")) {
    const key = element.dataset.i18nTooltip as MessageKey | undefined;
    if (key) element.setAttribute("data-tooltip", t(key));
  }
}

/**
 * Marks the document's language so `:lang()` styling, hyphenation, line
 * breaking, and screen-reader pronunciation all follow the rendered copy rather
 * than whatever the build happened to bake in.
 */
export function applyDocumentLanguage(locale: string): void {
  document.documentElement.lang = locale;
}
