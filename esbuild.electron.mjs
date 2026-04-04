import * as esbuild from "esbuild";

const isDev = process.argv.includes("--dev");

// Bundle the Electron main process
// This inlines dependencies like @huggingface/hub that aren't available
// in the packaged app's ASAR archive (which excludes node_modules)
await esbuild.build({
  entryPoints: ["electron/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "electron-dist/main.js",
  format: "cjs",
  sourcemap: isDev ? "inline" : false,
  minify: !isDev,
  external: [
    // Electron is provided by the runtime
    "electron",
    // Native modules must stay external (they're rebuilt for Electron)
    "better-sqlite3",
    "onnxruntime-node",
    "@lancedb/*",
  ],
  define: {
    "process.env.NODE_ENV": isDev ? '"development"' : '"production"',
  },
  logLevel: "info",
});


console.log("Electron build complete");
