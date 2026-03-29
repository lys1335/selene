import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isVisionModelInstalled,
} from "@/lib/ghost-os/setup";

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

describe("Ghost OS Setup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("isVisionModelInstalled", () => {
    it("should return true when model directory has sentinel files", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue(["config.json", "model.safetensors"]);

      expect(isVisionModelInstalled()).toBe(true);
    });

    it("should return true when directory has a .safetensors file", () => {
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
});
