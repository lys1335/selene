import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isVisionModelInstalled,
} from "@/lib/ghost-os/setup";
import {
  GHOST_OS_SERVER_NAME,
  isGhostOsTool,
} from "@/lib/ghost-os/config";

// These tests focus on the pure/synchronous functions from setup and config
// since mocking child_process.execFile + promisify across ESM boundaries is fragile.
// The async functions (resolveGhostBinary, getGhostVersion, etc.) are tested
// via integration tests that rely on real `ghost` binary availability.

// Mock only fs for the synchronous isVisionModelInstalled
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import * as fs from "fs";

describe("Ghost OS Setup (sync functions)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("isVisionModelInstalled", () => {
    it("should return true when model directory has files", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue(["config.json", "model.safetensors"]);

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

    it("should return false on fs error", () => {
      (fs.existsSync as any).mockImplementation(() => {
        throw new Error("permission denied");
      });

      expect(isVisionModelInstalled()).toBe(false);
    });
  });
});

describe("Ghost OS Config identifiers", () => {
  it("should have correct server name", () => {
    expect(GHOST_OS_SERVER_NAME).toBe("ghostos");
  });

  it("should identify Ghost OS tools by ID prefix", () => {
    expect(isGhostOsTool("mcp_ghostos_ghost_click")).toBe(true);
    expect(isGhostOsTool("mcp_linear_create_issue")).toBe(false);
  });
});
