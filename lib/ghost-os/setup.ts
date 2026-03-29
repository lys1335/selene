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
import type { GhostOsStatus, GhostDoctorResult } from "./types";

const execFileAsync = promisify(execFile);

/** Default Homebrew paths where ghost binary may be installed */
const HOMEBREW_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

/** Ghost OS model storage directory */
const GHOST_OS_HOME = path.join(
  process.env.HOME || "~",
  ".ghost-os"
);

const VISION_MODEL_DIR = path.join(GHOST_OS_HOME, "models", "ShowUI-2B");

/**
 * Resolve the ghost binary path from PATH or known locations.
 * Returns null if not found.
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
      return resolved;
    }
  } catch {
    // `which` failed — try known paths directly
  }

  // Fallback: check known Homebrew locations
  for (const dir of HOMEBREW_PATHS) {
    const candidate = path.join(dir, "ghost");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Get Ghost OS version from the binary.
 * Returns null if binary not found or version command fails.
 */
export async function getGhostVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], {
      timeout: 5000,
    });
    // Expected format: "ghost-os 2.2.1" or "Ghost OS v2.2.1"
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Check if ShowUI-2B vision model is installed.
 * Looks for the model directory and a sentinel file.
 */
export function isVisionModelInstalled(): boolean {
  try {
    // Check for model directory existence and a known file
    if (!fs.existsSync(VISION_MODEL_DIR)) {
      return false;
    }
    // Check for at least one model file (config.json or model files)
    const files = fs.readdirSync(VISION_MODEL_DIR);
    return files.length > 0;
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
    const message = error instanceof Error ? error.message : String(error);
    return {
      raw: `ghost doctor failed: ${message}`,
      healthy: false,
      checks: [],
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
    const stderr = error instanceof Error ? error.message : String(error);
    return { success: false, stdout: "", stderr };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse `ghost doctor` output into structured checks.
 * Ghost doctor output format varies by version, so we parse conservatively.
 */
function parseDoctorChecks(
  output: string
): { name: string; passed: boolean; detail?: string }[] {
  const checks: { name: string; passed: boolean; detail?: string }[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Look for check/pass/fail indicators
    // Common patterns: "✓ Accessibility", "✗ Screen Recording", "[PASS]", "[FAIL]"
    const passMatch = trimmed.match(/^[✓✅☑\[PASS\]]\s*(.+)/i);
    const failMatch = trimmed.match(/^[✗❌☐\[FAIL\]]\s*(.+)/i);

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
function parsePermissionsFromDoctor(
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

  // If no checks were parsed but doctor was healthy, assume permissions granted
  if (doctor.healthy && doctor.checks.length === 0) {
    permissions.accessibility = true;
    permissions.screenRecording = true;
  }

  return permissions;
}
