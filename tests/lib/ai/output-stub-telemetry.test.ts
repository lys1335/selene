import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _clearTelemetryIndex,
  _telemetryIndexSize,
  recordRetrieval,
  recordTier,
} from "@/lib/ai/output-stub-telemetry";

function parseTelemetryLine(msg: unknown): Record<string, unknown> | undefined {
  const str = String(msg);
  const match = str.match(/\[OutputStubTelemetry\] (\{.*\})$/);
  if (!match) return undefined;
  return JSON.parse(match[1]);
}

function lastPayload(
  spy: ReturnType<typeof vi.fn>
): Record<string, unknown> | undefined {
  const calls = spy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const parsed = parseTelemetryLine(calls[i][0]);
    if (parsed) return parsed;
  }
  return undefined;
}

describe("output-stub-telemetry", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _clearTelemetryIndex();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("emits a tool_output_tier event with the expected shape", () => {
    recordTier({
      sessionId: "sess_1",
      toolCallId: "call_1",
      toolName: "executeCommand",
      originalTokens: 42_730,
      originalChars: 342_108,
      originalLines: 8_421,
      tier: "stub_only",
      retrievalId: "log_abc",
      retrievalIdType: "logId",
    });

    const payload = lastPayload(infoSpy as unknown as ReturnType<typeof vi.fn>);
    expect(payload).toBeDefined();
    expect(payload?.event).toBe("tool_output_tier");
    expect(payload?.sessionId).toBe("sess_1");
    expect(payload?.toolCallId).toBe("call_1");
    expect(payload?.toolName).toBe("executeCommand");
    expect(payload?.originalTokens).toBe(42_730);
    expect(payload?.originalChars).toBe(342_108);
    expect(payload?.originalLines).toBe(8_421);
    expect(payload?.tier).toBe("stub_only");
    expect(payload?.retrievalId).toBe("log_abc");
    expect(payload?.retrievalIdType).toBe("logId");
    expect(typeof payload?.timestamp).toBe("string");
  });

  it("indexes a tier record so a later retrieval can correlate", () => {
    recordTier({
      sessionId: "sess_corr",
      toolName: "executeCommand",
      originalTokens: 30_000,
      originalChars: 120_000,
      originalLines: 3_000,
      tier: "stub_only",
      retrievalId: "log_xyz",
      retrievalIdType: "logId",
    });

    recordRetrieval({
      retrievalId: "log_xyz",
      retrievalIdType: "logId",
      sliceMode: "grep",
      sliceParams: { grep: "error", matches: 7 },
      returnedTokens: 2_140,
      budgetHit: false,
    });

    const payload = lastPayload(infoSpy as unknown as ReturnType<typeof vi.fn>);
    expect(payload).toBeDefined();
    expect(payload?.event).toBe("tool_output_retrieval");
    expect(payload?.retrievalId).toBe("log_xyz");
    expect(payload?.sliceMode).toBe("grep");
    expect(payload?.returnedTokens).toBe(2_140);
    expect(payload?.budgetHit).toBe(false);
    // Correlation — these fields come from the indexed tier record.
    expect(payload?.sessionId).toBe("sess_corr");
    expect(payload?.sourceTier).toBe("stub_only");
    expect(payload?.sourceToolName).toBe("executeCommand");
    expect(typeof payload?.millisSinceStub).toBe("number");
  });

  it("leaves correlation fields undefined when no prior tier record exists", () => {
    recordRetrieval({
      retrievalId: "log_orphan",
      retrievalIdType: "logId",
      sliceMode: "head",
      sliceParams: { head: 100 },
      returnedTokens: 800,
      budgetHit: false,
    });

    const payload = lastPayload(infoSpy as unknown as ReturnType<typeof vi.fn>);
    expect(payload).toBeDefined();
    expect(payload?.event).toBe("tool_output_retrieval");
    expect(payload?.sessionId).toBeUndefined();
    expect(payload?.sourceTier).toBeUndefined();
    expect(payload?.millisSinceStub).toBeUndefined();
  });

  it("does not index passthrough results (no retrievalId)", () => {
    recordTier({
      sessionId: "sess_pt",
      toolName: "webSearch",
      originalTokens: 500,
      originalChars: 2_000,
      originalLines: 40,
      tier: "passthrough",
    });

    expect(_telemetryIndexSize()).toBe(0);
  });

  it("bounds memory by evicting oldest tier records past the cap", () => {
    // 505 entries with distinct retrievalIds -> cap is 500.
    for (let i = 0; i < 505; i++) {
      recordTier({
        sessionId: "s",
        toolName: "executeCommand",
        originalTokens: 30_000,
        originalChars: 120_000,
        originalLines: 3_000,
        tier: "stub_only",
        retrievalId: `log_${i}`,
        retrievalIdType: "logId",
      });
    }

    expect(_telemetryIndexSize()).toBeLessThanOrEqual(500);

    // The first entries should have been evicted; the last should still resolve.
    infoSpy.mockClear();
    recordRetrieval({
      retrievalId: "log_0",
      retrievalIdType: "logId",
      sliceMode: "head",
      returnedTokens: 100,
      budgetHit: false,
    });
    const evicted = lastPayload(infoSpy as unknown as ReturnType<typeof vi.fn>);
    expect(evicted?.sourceTier).toBeUndefined();

    recordRetrieval({
      retrievalId: "log_504",
      retrievalIdType: "logId",
      sliceMode: "head",
      returnedTokens: 100,
      budgetHit: false,
    });
    const kept = lastPayload(infoSpy as unknown as ReturnType<typeof vi.fn>);
    expect(kept?.sourceTier).toBe("stub_only");
  });
});
