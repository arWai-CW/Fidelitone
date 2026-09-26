import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";

// Flatten HTML output from dist/src/*/  →  dist/
// Copy manifest.json from project root, patch paths, clean up src/.
function flatHtmlOutput(): Plugin {
  return {
    name: "flat-html-output",
    closeBundle() {
      const pairs: [string, string][] = [
        ["dist/src/popup/popup.html", "dist/popup.html"],
        ["dist/src/offscreen/offscreen.html", "dist/offscreen.html"],
      ];
      for (const [from, to] of pairs) {
        if (existsSync(from)) renameSync(from, to);
      }

      // Fix relative asset paths: dist/src/*/file.html → dist/file.html
      // Vite generates paths from source location (../../assets/), need to strip leading ../
      for (const [, to] of pairs) {
        if (!existsSync(to)) continue;
        let html = readFileSync(to, "utf8");
        html = html.replace(/"\.\.\/\.\.\//g, '"');
        html = html.replace(/'\.\.\/\.\.\//g, "'");
        writeFileSync(to, html);
      }

      const srcDir = "dist/src";
      if (existsSync(srcDir)) rmSync(srcDir, { recursive: true });

      copyFileSync("manifest.json", "dist/manifest.json");
      const m = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
      if (m.action?.default_popup) m.action.default_popup = "popup.html";
      if (m.offscreen?.page) m.offscreen.page = "offscreen.html";
      writeFileSync("dist/manifest.json", JSON.stringify(m, null, 2) + "\n");

      // Copy icons/ to dist/icons/
      if (existsSync("icons")) {
        const iconsDir = "dist/icons";
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        for (const f of readdirSync("icons")) {
          if (statSync(`icons/${f}`).isFile()) copyFileSync(`icons/${f}`, `${iconsDir}/${f}`);
        }
      }

      // Copy processors/ to dist/processors/ (plain JS worklet scripts)
      if (existsSync("src/processors")) {
        const procDir = "dist/processors";
        if (!existsSync(procDir)) mkdirSync(procDir, { recursive: true });
        for (const f of readdirSync("src/processors")) {
          if (f.endsWith(".js") && statSync(`src/processors/${f}`).isFile()) {
            copyFileSync(`src/processors/${f}`, `${procDir}/${f}`);
          }
        }
      }

      // Shared DSP modules are imported by plain-JS worklets and must exist beside them.
      const dspDir = "dist/lib/dsp";
      if (!existsSync(dspDir)) mkdirSync(dspDir, { recursive: true });
      for (const name of ["math.js", "math.d.ts"]) {
        copyFileSync(`src/lib/dsp/${name}`, `${dspDir}/${name}`);
      }

      // Signalsmith embeds its WASM in this self-contained worklet module. Copy
      // it as a static extension asset so the factory can use moduleUrl instead
      // of creating a blob URL at runtime.
      const signalsmithSource = "node_modules/signalsmith-stretch/SignalsmithStretch.mjs";
      if (existsSync(signalsmithSource)) {
        const procDir = "dist/processors";
        if (!existsSync(procDir)) mkdirSync(procDir, { recursive: true });
        copyFileSync(signalsmithSource, `${procDir}/signalsmith-stretch.js`);
      }
    },
  };
}

export default defineConfig({
  base: "",
  test: {
    include: ["src/tests/**/*.test.ts"],
  },
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/popup.html"),
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        // The manifest references the service worker by a fixed name, so the
        // background chunk must not get a content hash.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
  plugins: [flatHtmlOutput()],
});
