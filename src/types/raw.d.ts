// Vite serves any imported file as a string with `?raw`. The catalog guard
// reads popup.html and popup.ts this way instead of through node:fs, which
// keeps the test inside the project's existing type setup (there is no
// @types/node) and lets Vite resolve the path the same way the build does.

declare module "*?raw" {
  const content: string;
  export default content;
}
