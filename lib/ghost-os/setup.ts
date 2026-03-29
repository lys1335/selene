/**
 * Ghost OS Setup & Detection
 *
 * Handles binary detection, version checking, permission status,
 * and setup/doctor commands for Ghost OS integration.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { GhostOsStatus, GhostDoctorResult } from "./types";

const execFileAsync = promisify(execFile);

/** Default Homebrew paths where ghost binary may be installed */
const HOMEBREW_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

/** Ghost OS model storage directory */
const GHOST_OS_HOME = path.join(os.homedir(), ".ghost-os");

const VISION_MODEL_DIR = path.join(GHOST_OS_HOME, "models", "ShowUI-2B");

/**
 * Sentinel file names that indicate a valid ShowUI-2B installation.
 * We check if any file in the model dir matches one of these exactly (for "config.json")
 * or ends with the suffix (for ".safetensors" — model files are sharded like
 * "model-00001-of-00004.safetensors").
 */
const VISION_MODEL_SENTINEL_EXACT = ["config.json"];
const VISION_MODEL_SENTINEL_SUFFIX = [".safetensors"];

/**
 * Resolve the ghost binary path from PATH or known locations.
 * Returns null if not found or if the binary is not Ghost OS (e.g., Ghost CMS CLI).
 */
export async function resolveGhostBinary(): Promise<string | null> {
  // Try `which ghost` first (works on macOS/Linux)
  try {
    const { stdout } = await execFileAsync("which", ["ghost"], {
      timeout: 5000,
      env: {
        ...process.env,
        PATH: [
          process.env.PATH || "",
          ...HOMEBREW_PATHS,
        ].join(":"),
      },
    });
    const resolved = stdout.trim();
    if (resolved && fs.existsSync(resolved)) {
      const verified = await verifyGhostOsBinary(resolved);
      if (verified) return resolved;
    }
  } catch {
    // `which` failed — try known paths directly
  }

  // Fallback: check known Homebrew locations
  for (const dir of HOMEBREW_PATHS) {
    const candidate = path.join(dir, "ghost");
    if (fs.existsSync(candidate)) {
      const verified = await verifyGhostOsBinary(candidate);
      if (verified) return candidate;
    }
  }

  return null;
}

/**
 * Verify that a binary is actually Ghost OS (not Ghost CMS CLI or something else).
 * Checks that --version output contains "ghost-os" or "ghost os".
 */
async function verifyGhostOsBinary(binaryPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], {
      timeout: 3000,
    });
    const lower = stdout.toLowerCase();
    // Ghost OS version output should contain "ghost-os" or "ghost os"
    // Ghost CMS CLI outputs "Ghost-CLI version X.Y.Z"
    return (
      lower.includes("ghost-os") ||
      lower.includes("ghost os") ||
      // Also accept if it contains "axorcist" (Ghost OS internal component)
      lower.includes("axorcist")
    );
  } catch {
    return false;
  }
}

/**
 * Get Ghost OS version from the binary.
 * Returns null if binary not found or version cannot be parsed.
 */
export async function getGhostVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], {
      timeout: 5000,
    });
    // Expected format: "ghost-os 2.2.1" or "Ghost OS v2.2.1"
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if ShowUI-2B vision model is installed.
 * Looks for the model directory and a known sentinel file (config.json or .safetensors).
 */
export function isVisionModelInstalled(): boolean {
  try {
    if (!fs.existsSync(VISION_MODEL_DIR)) {
      return false;
    }
    const files = fs.readdirSync(VISION_MODEL_DIR);
    // Check for a known required file — not just "any file exists"
    return files.some(
      (f) =>
        VISION_MODEL_SENTINEL_EXACT.includes(f) ||
        VISION_MODEL_SENTINEL_SUFFIX.some((suffix) => f.endsWith(suffix)),
    );
  } catch {
    return false;
  }
}

/**
 * Get comprehensive Ghost OS status.
 * Non-throwing — returns a status object with all fields populated.
 */
export async function getGhostOsStatus(): Promise<GhostOsStatus> {
  const binaryPath = await resolveGhostBinary();

  if (!binaryPath) {
    return {
      installed: false,
      visionModelInstalled: false,
      permissions: {
        accessibility: false,
        screenRecording: false,
        inputMonitoring: false,
      },
    };
  }

  const version = await getGhostVersion(binaryPath);
  const visionModelInstalled = isVisionModelInstalled();

  // Run `ghost doctor` to check permissions
  const doctorResult = await runGhostDoctor(binaryPath);
  const permissions = parsePermissionsFromDoctor(doctorResult);

  return {
    installed: true,
    version: version || undefined,
    visionModelInstalled,
    permissions,
    binaryPath,
  };
}

/**
 * Run `ghost doctor` and parse the output.
 */
export async function runGhostDoctor(binaryPath?: string): Promise<GhostDoctorResult> {
  const binary = binaryPath || (await resolveGhostBinary());
  if (!binary) {
    return {
      raw: "Ghost OS binary not found",
      healthy: false,
      checks: [],
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(binary, ["doctor"], {
      timeout: 30000,
      env: {
        ...process.env,
        PATH: [process.env.PATH || "", ...HOMEBREW_PATHS].join(":"),
      },
    });

    const raw = stdout + (stderr ? `\n${stderr}` : "");
    const checks = parseDoctorChecks(raw);
    const healthy = checks.every((c) => c.passed);

    return { raw, healthy, checks };
  } catch (error) {
    const errObj = error as { message?: string; stdout?: string; stderr?: string };
    const message = errObj.message || String(error);
    // Preserve stdout and stderr from partial output before failure
    const stdout = errObj.stdout || "";
    const stderr = errObj.stderr || "";
    const combined = [stdout, stderr].filter(Boolean).join("\n");
    return {
      raw: `ghost doctor failed: ${message}${combined ? `\n${combined}` : ""}`,
      healthy: false,
      checks: stdout ? parseDoctorChecks(stdout) : [],
    };
  }
}

/**
 * Run `ghost setup` to configure permissions and install components.
 */
export async function runGhostSetup(binaryPath?: string): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
}> {
  const binary = binaryPath || (await resolveGhostBinary());
  if (!binary) {
    return {
      success: false,
      stdout: "",
      stderr: "Ghost OS binary not found. Install via: brew install ghostwright/ghost-os/ghost-os",
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(binary, ["setup"], {
      timeout: 120000, // 2 minutes — setup may trigger permission dialogs
      env: {
        ...process.env,
        PATH: [process.env.PATH || "", ...HOMEBREW_PATHS].join(":"),
      },
    });
    return { success: true, stdout, stderr };
  } catch (error) {
    const errObj = error as { message?: string; stdout?: string; stderr?: string };
    const stderr = errObj.stderr || errObj.message || String(error);
    const stdout = errObj.stdout || "";
    return { success: false, stdout, stderr };
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers — exported for direct unit testing
// ---------------------------------------------------------------------------

/**
 * Parse `ghost doctor` output into structured checks.
 * Ghost doctor output format varies by version, so we parse conservatively.
 *
 * Uses non-capturing alternation groups to properly match multi-char tokens
 * like [PASS] and [FAIL], not just individual characters.
 */
export function parseDoctorChecks(
  output: string
): { name: string; passed: boolean; detail?: string }[] {
  const checks: { name: string; passed: boolean; detail?: string }[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match pass indicators: ✓, ✅, ☑, or [PASS]
    const passMatch = trimmed.match(/^(?:[✓✅☑]|\[PASS\])\s*(.+)/i);
    // Match fail indicators: ✗, ❌, ☐, or [FAIL]
    const failMatch = trimmed.match(/^(?:[✗❌☐]|\[FAIL\])\s*(.+)/i);

    if (passMatch) {
      checks.push({ name: passMatch[1].trim(), passed: true });
    } else if (failMatch) {
      checks.push({ name: failMatch[1].trim(), passed: false });
    }
  }

  return checks;
}

/**
 * Extract permission status from ghost doctor results.
 */
export function parsePermissionsFromDoctor(
  doctor: GhostDoctorResult
): GhostOsStatus["permissions"] {
  const permissions = {
    accessibility: false,
    screenRecording: false,
    inputMonitoring: false,
  };

  // Check parsed checks for permission names
  for (const check of doctor.checks) {
    const name = check.name.toLowerCase();
    if (name.includes("accessibility")) {
      permissions.accessibility = check.passed;
    } else if (name.includes("screen") && name.includes("record")) {
      permissions.screenRecording = check.passed;
    } else if (name.includes("input") && name.includes("monitor")) {
      permissions.inputMonitoring = check.passed;
    }
  }

  // If no checks were parsed but doctor was healthy, assume all permissions granted.
  // Consistent: either all three are true (healthy) or all three stay false (unhealthy).
  if (doctor.healthy && doctor.checks.length === 0) {
    permissions.accessibility = true;
    permissions.screenRecording = true;
    permissions.inputMonitoring = true;
  }

  return permissions;
}
