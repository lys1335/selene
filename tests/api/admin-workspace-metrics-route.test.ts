import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — swap env gating and the snapshot source per-test.
// ---------------------------------------------------------------------------

const envMocks = vi.hoisted(() => ({
  isLocalEnvironment: vi.fn(),
}));

const metricsMocks = vi.hoisted(() => ({
  getWorkspaceMetricsSnapshot: vi.fn(),
}));

vi.mock("@/lib/utils/environment", () => ({
  isLocalEnvironment: envMocks.isLocalEnvironment,
}));

vi.mock("@/lib/workspace/metrics", () => ({
  getWorkspaceMetricsSnapshot: metricsMocks.getWorkspaceMetricsSnapshot,
}));

import { GET } from "@/app/api/admin/workspace-metrics/route";

const baseSnapshot = () => ({
  counters: {
    created: 10,
    deleted: 2,
    cleanedBySessionDelete: 1,
    cleanedBySessionPurge: 0,
    cleanedByCharacterDelete: 0,
    cleanedByBootSweep: 0,
    cleanupErrors: 0,
  },
  activeRows: 7,
  orphanedRows: 0,
  ageBuckets: {
    lessThan1Day: 3,
    oneToSevenDays: 2,
    sevenToThirtyDays: 2,
    moreThanThirtyDays: 0,
  },
  startedAt: "2026-04-24T00:00:00.000Z",
  snapshotAt: "2026-04-24T12:00:00.000Z",
});

describe("GET /api/admin/workspace-metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    envMocks.isLocalEnvironment.mockReturnValue(true);
    metricsMocks.getWorkspaceMetricsSnapshot.mockResolvedValue(baseSnapshot());
  });

  it("returns 401 when not in a local environment", async () => {
    envMocks.isLocalEnvironment.mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(metricsMocks.getWorkspaceMetricsSnapshot).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns snapshot + all-false invariants on a healthy system", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.counters).toEqual(baseSnapshot().counters);
    expect(body.activeRows).toBe(7);
    expect(body.orphanedRows).toBe(0);
    expect(body.invariants).toEqual({
      hasOrphans: false,
      hasErrors: false,
      hasVeryOldRows: false,
      suspiciousLifecycleMismatch: false,
    });
  });

  it("sets hasOrphans when orphanedRows > 0", async () => {
    metricsMocks.getWorkspaceMetricsSnapshot.mockResolvedValue({
      ...baseSnapshot(),
      orphanedRows: 3,
    });
    const res = await GET();
    const body = await res.json();
    expect(body.invariants.hasOrphans).toBe(true);
    expect(body.invariants.hasErrors).toBe(false);
  });

  it("sets hasErrors when cleanupErrors > 0", async () => {
    const snap = baseSnapshot();
    snap.counters.cleanupErrors = 2;
    metricsMocks.getWorkspaceMetricsSnapshot.mockResolvedValue(snap);
    const res = await GET();
    const body = await res.json();
    expect(body.invariants.hasErrors).toBe(true);
  });

  it("sets hasVeryOldRows when moreThanThirtyDays > 0", async () => {
    const snap = baseSnapshot();
    snap.ageBuckets.moreThanThirtyDays = 1;
    metricsMocks.getWorkspaceMetricsSnapshot.mockResolvedValue(snap);
    const res = await GET();
    const body = await res.json();
    expect(body.invariants.hasVeryOldRows).toBe(true);
  });

  it("sets suspiciousLifecycleMismatch when deletions exceed creations", async () => {
    const snap = baseSnapshot();
    // 0 created but lots of cleanups — accounting drift.
    snap.counters.created = 0;
    snap.counters.deleted = 5;
    snap.counters.cleanedBySessionDelete = 3;
    snap.counters.cleanedBySessionPurge = 2;
    snap.counters.cleanedByCharacterDelete = 1;
    snap.counters.cleanedByBootSweep = 1;
    metricsMocks.getWorkspaceMetricsSnapshot.mockResolvedValue(snap);
    const res = await GET();
    const body = await res.json();
    expect(body.invariants.suspiciousLifecycleMismatch).toBe(true);
  });

  it("returns 500 when snapshot generation throws", async () => {
    metricsMocks.getWorkspaceMetricsSnapshot.mockRejectedValueOnce(
      new Error("db unavailable"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Failed to build workspace metrics snapshot");
  });
});
