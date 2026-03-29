import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isVisionSidecarTool, ensureVisionSidecar } from "@/lib/ghost-os/vision-sidecar";

describe("Ghost OS Vision Sidecar", () => {
  describe("isVisionSidecarTool", () => {
    it("returns true for ghost_parse_screen", () => {
      expect(isVisionSidecarTool("ghost_parse_screen")).toBe(true);
    });

    it("returns true for ghost_annotate", () => {
      expect(isVisionSidecarTool("ghost_annotate")).toBe(true);
    });

    it("returns false for ghost_ground (auto-starts sidecar itself)", () => {
      expect(isVisionSidecarTool("ghost_ground")).toBe(false);
    });

    it("returns false for non-vision tools", () => {
      expect(isVisionSidecarTool("ghost_click")).toBe(false);
      expect(isVisionSidecarTool("ghost_context")).toBe(false);
      expect(isVisionSidecarTool("ghost_read")).toBe(false);
    });
  });

  describe("ensureVisionSidecar", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns null immediately when sidecar is already running", async () => {
      // Mock fetch to simulate healthy sidecar
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

      const mockExecute = vi.fn();
      const result = await ensureVisionSidecar(mockExecute);

      expect(result).toBeNull();
      // ghost_ground should NOT have been called — sidecar was already up
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("calls ghost_ground to boot sidecar when not running, then succeeds", async () => {
      let callCount = 0;
      // First call: sidecar not running. After ghost_ground: sidecar running.
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.reject(new Error("Connection refused"));
        }
        return Promise.resolve({ ok: true });
      });

      const mockExecute = vi.fn().mockResolvedValue({ content: [] });
      const result = await ensureVisionSidecar(mockExecute);

      expect(result).toBeNull();
      expect(mockExecute).toHaveBeenCalledWith(
        "ghostos",
        "ghost_ground",
        { description: "any element" }
      );
    });

    it("returns error message when sidecar fails to start after ghost_ground", async () => {
      // Sidecar never comes up
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const mockExecute = vi.fn().mockResolvedValue({ content: [] });
      const result = await ensureVisionSidecar(mockExecute);

      expect(result).toContain("Vision sidecar failed to start");
      expect(result).toContain("ghost setup --vision");
    }, 20000); // Longer timeout since it polls for up to 15s

    it("still waits for sidecar even if ghost_ground throws", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new Error("Connection refused"));
        }
        return Promise.resolve({ ok: true });
      });

      const mockExecute = vi.fn().mockRejectedValue(new Error("ghost_ground failed"));
      const result = await ensureVisionSidecar(mockExecute);

      // Should still succeed because sidecar eventually came up
      expect(result).toBeNull();
    });
  });
});
