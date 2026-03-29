import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";

// Mock only fs for the synchronous isVisionModelInstalled
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import {
  isVisionModelInstalled,
  parseDoctorChecks,
  parsePermissionsFromDoctor,
} from "@/lib/ghost-os/setup";
import type { GhostDoctorResult } from "@/lib/ghost-os/types";

describe("Ghost OS Setup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // isVisionModelInstalled
  // ===========================================================================
  describe("isVisionModelInstalled", () => {
    it("should return true when model directory has config.json", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue(["config.json", "model.safetensors"]);

      expect(isVisionModelInstalled()).toBe(true);
    });

    it("should return true when directory has a .safetensors file (sharded)", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue(["model-00001-of-00004.safetensors"]);

      expect(isVisionModelInstalled()).toBe(true);
    });

    it("should return false when model directory does not exist", () => {
      (fs.existsSync as any).mockReturnValue(false);

      expect(isVisionModelInstalled()).toBe(false);
    });

    it("should return false when model directory is empty", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue([]);

      expect(isVisionModelInstalled()).toBe(false);
    });

    it("should return false when directory only has non-sentinel files (.DS_Store, temp files)", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue([".DS_Store", "download.tmp", "README.md"]);

      expect(isVisionModelInstalled()).toBe(false);
    });

    it("should return false on fs error", () => {
      (fs.existsSync as any).mockImplementation(() => {
        throw new Error("permission denied");
      });

      expect(isVisionModelInstalled()).toBe(false);
    });
  });

  // ===========================================================================
  // parseDoctorChecks — tests the doctor output parser directly
  // ===========================================================================
  describe("parseDoctorChecks", () => {
    it("should parse ✓/✗ checkmark indicators", () => {
      const output = "✓ Accessibility granted\n✓ Screen Recording granted\n✗ Input Monitoring denied";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(3);
      expect(checks[0]).toEqual({ name: "Accessibility granted", passed: true });
      expect(checks[1]).toEqual({ name: "Screen Recording granted", passed: true });
      expect(checks[2]).toEqual({ name: "Input Monitoring denied", passed: false });
    });

    it("should parse [PASS]/[FAIL] indicators", () => {
      const output = "[PASS] Accessibility\n[FAIL] Screen Recording";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(2);
      expect(checks[0]).toEqual({ name: "Accessibility", passed: true });
      expect(checks[1]).toEqual({ name: "Screen Recording", passed: false });
    });

    it("should parse ✅/❌ emoji indicators", () => {
      const output = "✅ Accessibility OK\n❌ Screen Recording missing";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(2);
      expect(checks[0].passed).toBe(true);
      expect(checks[0].name).toBe("Accessibility OK");
      expect(checks[1].passed).toBe(false);
      expect(checks[1].name).toBe("Screen Recording missing");
    });

    it("should parse ☑/☐ checkbox indicators", () => {
      const output = "☑ Input Monitoring\n☐ Screen Recording";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(2);
      expect(checks[0]).toEqual({ name: "Input Monitoring", passed: true });
      expect(checks[1]).toEqual({ name: "Screen Recording", passed: false });
    });

    it("should skip lines without recognized indicators", () => {
      const output = "Ghost OS Doctor Report\n✓ Accessibility\nAll systems nominal.\n✗ Screen Recording";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(2);
      expect(checks[0].name).toBe("Accessibility");
      expect(checks[1].name).toBe("Screen Recording");
    });

    it("should return empty array for unparseable output", () => {
      const output = "Ghost OS Doctor Report\nAll systems nominal.";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(0);
    });

    it("should handle empty input", () => {
      expect(parseDoctorChecks("")).toHaveLength(0);
    });

    it("should handle mixed indicator styles", () => {
      const output = "✓ Accessibility\n[PASS] Screen Recording\n❌ Input Monitoring\n☐ Vision Model";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(4);
      expect(checks[0].passed).toBe(true);
      expect(checks[1].passed).toBe(true);
      expect(checks[2].passed).toBe(false);
      expect(checks[3].passed).toBe(false);
    });

    it("should trim whitespace from check names", () => {
      const output = "✓   Accessibility   ";
      const checks = parseDoctorChecks(output);

      expect(checks).toHaveLength(1);
      expect(checks[0].name).toBe("Accessibility");
    });
  });

  // ===========================================================================
  // parsePermissionsFromDoctor
  // ===========================================================================
  describe("parsePermissionsFromDoctor", () => {
    it("should extract all three permissions from check names", () => {
      const doctor: GhostDoctorResult = {
        raw: "",
        healthy: true,
        checks: [
          { name: "Accessibility access granted", passed: true },
          { name: "Screen Recording permission", passed: true },
          { name: "Input Monitoring enabled", passed: false },
        ],
      };

      const perms = parsePermissionsFromDoctor(doctor);
      expect(perms.accessibility).toBe(true);
      expect(perms.screenRecording).toBe(true);
      expect(perms.inputMonitoring).toBe(false);
    });

    it("should default all to false when no checks parsed", () => {
      const doctor: GhostDoctorResult = {
        raw: "everything is broken",
        healthy: false,
        checks: [],
      };

      const perms = parsePermissionsFromDoctor(doctor);
      expect(perms.accessibility).toBe(false);
      expect(perms.screenRecording).toBe(false);
      expect(perms.inputMonitoring).toBe(false);
    });

    it("should assume all granted when healthy but no checks parsed (consistent fallback)", () => {
      const doctor: GhostDoctorResult = {
        raw: "All good!",
        healthy: true,
        checks: [],
      };

      const perms = parsePermissionsFromDoctor(doctor);
      // All three should be true — consistent, not partial
      expect(perms.accessibility).toBe(true);
      expect(perms.screenRecording).toBe(true);
      expect(perms.inputMonitoring).toBe(true);
    });

    it("should handle partial check matches", () => {
      const doctor: GhostDoctorResult = {
        raw: "",
        healthy: false,
        checks: [
          { name: "Accessibility OK", passed: true },
          // No screen recording or input monitoring checks
        ],
      };

      const perms = parsePermissionsFromDoctor(doctor);
      expect(perms.accessibility).toBe(true);
      expect(perms.screenRecording).toBe(false);
      expect(perms.inputMonitoring).toBe(false);
    });
  });
});
