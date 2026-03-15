import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getSession: dbMocks.getSession,
  updateSession: dbMocks.updateSession,
}));

import { createUpdatePlanTool } from "@/lib/ai/tools/update-plan-tool";

describe("update-plan-tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.updateSession.mockResolvedValue(undefined);
  });

  it("returns full plan payload for merge updates", async () => {
    dbMocks.getSession.mockResolvedValue({
      metadata: {
        plan: {
          version: 1,
          steps: [
            { id: "step_a", text: "Inspect code path", status: "in_progress" },
            { id: "step_b", text: "Patch regression", status: "pending" },
          ],
          updatedAt: "2026-03-15T10:00:00.000Z",
        },
      },
    });

    const tool = createUpdatePlanTool({ sessionId: "session-123" });

    const result = await tool.execute({
      mode: "merge",
      explanation: "Mark first step done and move to patching",
      steps: [
        { id: "step_a", status: "completed" },
        { id: "step_b", status: "in_progress" },
      ],
    });

    expect(result.status).toBe("success");
    expect(result.version).toBe(2);
    expect(result.plan).toEqual(
      expect.objectContaining({
        version: 2,
        explanation: "Mark first step done and move to patching",
        steps: [
          { id: "step_a", text: "Inspect code path", status: "completed" },
          { id: "step_b", text: "Patch regression", status: "in_progress" },
        ],
      })
    );
    expect(result.updatedStepIds).toEqual(["step_a", "step_b"]);

    expect(dbMocks.updateSession).toHaveBeenCalledWith(
      "session-123",
      expect.objectContaining({
        metadata: expect.objectContaining({
          plan: expect.objectContaining({
            version: 2,
            steps: [
              { id: "step_a", text: "Inspect code path", status: "completed" },
              { id: "step_b", text: "Patch regression", status: "in_progress" },
            ],
          }),
        }),
      })
    );
  });
});
