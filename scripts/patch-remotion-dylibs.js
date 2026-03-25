#!/usr/bin/env node
/**
 * Patch Remotion compositor dylib references for macOS.
 *
 * Problem: The Remotion compositor binary (`remotion`) links against
 * FFmpeg dylibs using bare names (e.g., `libavcodec.dylib`). Remotion
 * sets DYLD_LIBRARY_PATH at spawn time to resolve these, but macOS
 * SIP strips DYLD_* env vars from child processes spawned by hardened
 * runtimes (like Electron). This causes the compositor to crash with
 * "dyld: Library not loaded" → surfaced as ECONNRESET/socket hang up.
 *
 * Fix: Use install_name_tool to rewrite all references to use
 * @loader_path/, which tells dyld to look in the same directory as
 * the binary/dylib. This works regardless of SIP or DYLD_* stripping.
 *
 * Run: node scripts/patch-remotion-dylibs.js
 * Also runs automatically via the postinstall hook.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

if (process.platform !== "darwin") {
  console.log("[patch-remotion-dylibs] Skipping — not macOS");
  process.exit(0);
}

const compositorDir = path.join(
  __dirname,
  "..",
  "node_modules",
  "@remotion",
  `compositor-darwin-${process.arch}`
);

if (!fs.existsSync(compositorDir)) {
  console.log(`[patch-remotion-dylibs] Skipping — ${compositorDir} not found`);
  process.exit(0);
}

const binary = path.join(compositorDir, "remotion");
if (!fs.existsSync(binary)) {
  console.log("[patch-remotion-dylibs] Skipping — remotion binary not found");
  process.exit(0);
}

const DYLIBS = [
  "libavcodec.dylib",
  "libavdevice.dylib",
  "libavfilter.dylib",
  "libavformat.dylib",
  "libavutil.dylib",
  "libswresample.dylib",
  "libswscale.dylib",
];

// Check if already patched by inspecting the binary's references
try {
  const otoolOutput = execSync(`otool -L "${binary}"`, { encoding: "utf-8" });
  if (otoolOutput.includes("@loader_path/")) {
    console.log("[patch-remotion-dylibs] Already patched — skipping");
    process.exit(0);
  }
} catch {
  // otool not available, proceed with patching anyway
}

console.log("[patch-remotion-dylibs] Patching Remotion compositor dylibs...");

// 1. Patch dylib install names
for (const dylib of DYLIBS) {
  const dylibPath = path.join(compositorDir, dylib);
  if (!fs.existsSync(dylibPath)) continue;
  execSync(`install_name_tool -id "@loader_path/${dylib}" "${dylibPath}"`, {
    stdio: "pipe",
  });
}

// 2. Patch binary references
for (const dylib of DYLIBS) {
  execSync(
    `install_name_tool -change "${dylib}" "@loader_path/${dylib}" "${binary}"`,
    { stdio: "pipe" }
  );
}

// 3. Patch inter-dylib references (dylibs that depend on each other)
for (const target of DYLIBS) {
  const targetPath = path.join(compositorDir, target);
  if (!fs.existsSync(targetPath)) continue;
  for (const ref of DYLIBS) {
    if (target === ref) continue;
    try {
      execSync(
        `install_name_tool -change "${ref}" "@loader_path/${ref}" "${targetPath}"`,
        { stdio: "pipe" }
      );
    } catch {
      // Some dylibs don't reference others — that's fine
    }
  }
}

console.log("[patch-remotion-dylibs] Done — compositor dylibs patched with @loader_path");
