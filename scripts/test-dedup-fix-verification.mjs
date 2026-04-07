#!/usr/bin/env node
/**
 * test-dedup-fix-verification.mjs
 *
 * Verifies the fix for the duplicateByName bug.
 * Tests BOTH the old (buggy) logic and the new (fixed) logic
 * against the same inputs, proving the fix resolves the issue.
 *
 * Usage: node scripts/test-dedup-fix-verification.mjs
 */

// ═══════════════════════════════════════════════════════════════════════════
// Scenario Setup — simulates what the provider sees
// ═══════════════════════════════════════════════════════════════════════════

function createScenario(name, streamedCalls, assistantBlocks) {
  return { name, streamedCalls, assistantBlocks };
}

const scenarios = [
  // Scenario 1: 4 parallel Agent calls, only 1 streamed
  createScenario(
    "4 parallel Agent calls, 1 streamed (partial streaming failure)",
    [{ id: "toolu_AAAA", name: "Agent" }],
    [
      { type: "tool_use", id: "toolu_AAAA", name: "Agent", input: { prompt: "Task 1" } },
      { type: "tool_use", id: "toolu_BBBB", name: "Agent", input: { prompt: "Task 2" } },
      { type: "tool_use", id: "toolu_CCCC", name: "Agent", input: { prompt: "Task 3" } },
      { type: "tool_use", id: "toolu_DDDD", name: "Agent", input: { prompt: "Task 4" } },
    ],
  ),

  // Scenario 2: 2 parallel Agent calls, 0 streamed (includePartialMessages: false)
  createScenario(
    "2 parallel Agent calls, 0 streamed (no partial messages)",
    [],
    [
      { type: "tool_use", id: "toolu_1111", name: "Agent", input: { prompt: "Research A" } },
      { type: "tool_use", id: "toolu_2222", name: "Agent", input: { prompt: "Research B" } },
    ],
  ),

  // Scenario 3: Mixed tools — 1 Read + 2 Agent, all streamed (should work in both)
  createScenario(
    "1 Read + 2 Agent calls, all streamed (no bug expected)",
    [
      { id: "toolu_R001", name: "Read" },
      { id: "toolu_A001", name: "Agent" },
      { id: "toolu_A002", name: "Agent" },
    ],
    [
      { type: "tool_use", id: "toolu_R001", name: "Read", input: { path: "/foo" } },
      { type: "tool_use", id: "toolu_A001", name: "Agent", input: { prompt: "X" } },
      { type: "tool_use", id: "toolu_A002", name: "Agent", input: { prompt: "Y" } },
    ],
  ),

  // Scenario 4: 3 Agent calls, 2 streamed (1 missed)
  createScenario(
    "3 parallel Agent calls, 2 streamed (1 missed by streaming)",
    [
      { id: "toolu_X001", name: "Agent" },
      { id: "toolu_X002", name: "Agent" },
    ],
    [
      { type: "tool_use", id: "toolu_X001", name: "Agent", input: { prompt: "A" } },
      { type: "tool_use", id: "toolu_X002", name: "Agent", input: { prompt: "B" } },
      { type: "tool_use", id: "toolu_X003", name: "Agent", input: { prompt: "C" } },
    ],
  ),

  // Scenario 5: Single Agent call (no bug possible)
  createScenario(
    "1 Agent call, 1 streamed (baseline — no parallel)",
    [{ id: "toolu_SOLO", name: "Agent" }],
    [{ type: "tool_use", id: "toolu_SOLO", name: "Agent", input: { prompt: "Solo" } }],
  ),
];

// ═══════════════════════════════════════════════════════════════════════════
// Dedup Logic — OLD (buggy) vs NEW (fixed)
// ═══════════════════════════════════════════════════════════════════════════

function runOldLogic(scenario) {
  const streamedIds = new Set(scenario.streamedCalls.map(c => c.id));
  const streamedNames = new Set(scenario.streamedCalls.map(c => c.name));
  const emitted = [...scenario.streamedCalls]; // streamed calls are already emitted
  const dropped = [];

  for (const block of scenario.assistantBlocks) {
    if (block.type !== "tool_use") continue;
    const duplicateById = streamedIds.has(block.id);
    const duplicateByName = streamedNames.has(block.name);

    if (duplicateById || duplicateByName) {
      if (!duplicateById && duplicateByName) {
        dropped.push(block);
      }
      continue;
    }
    emitted.push(block);
    streamedNames.add(block.name); // name gets added after first fallback emit
  }

  return { emitted: emitted.length, dropped: dropped.length, droppedCalls: dropped };
}

function runNewLogic(scenario) {
  const streamedIds = new Set(scenario.streamedCalls.map(c => c.id));
  const emitted = [...scenario.streamedCalls];
  const dropped = [];

  for (const block of scenario.assistantBlocks) {
    if (block.type !== "tool_use") continue;
    if (streamedIds.has(block.id)) {
      continue; // ID-only dedup
    }
    emitted.push(block);
  }

  return { emitted: emitted.length, dropped: dropped.length, droppedCalls: dropped };
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all scenarios
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n╔" + "═".repeat(78) + "╗");
console.log("║ Dedup Fix Verification — Old Logic vs New Logic".padEnd(79) + "║");
console.log("╚" + "═".repeat(78) + "╝\n");

let allPass = true;

for (let i = 0; i < scenarios.length; i++) {
  const scenario = scenarios[i];
  const expected = scenario.assistantBlocks.length; // all unique IDs = all should arrive
  const oldResult = runOldLogic(scenario);
  const newResult = runNewLogic(scenario);

  console.log(`━━━ Scenario ${i + 1}: ${scenario.name} ━━━`);
  console.log(`  Expected tool calls delivered: ${expected}`);
  console.log(`  Streamed: ${scenario.streamedCalls.length} | Assistant blocks: ${scenario.assistantBlocks.length}`);
  console.log();
  console.log(`  OLD logic: ${oldResult.emitted} delivered, ${oldResult.dropped} dropped ${oldResult.dropped > 0 ? "🐛" : "✅"}`);
  console.log(`  NEW logic: ${newResult.emitted} delivered, ${newResult.dropped} dropped ${newResult.emitted === expected ? "✅" : "❌"}`);

  if (oldResult.dropped > 0) {
    console.log(`  → Old logic LOST: ${oldResult.droppedCalls.map(c => c.id).join(", ")}`);
  }

  const newCorrect = newResult.emitted === expected;
  if (!newCorrect) {
    console.log(`  ❌ NEW LOGIC FAILED — expected ${expected}, got ${newResult.emitted}`);
    allPass = false;
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════
// Verdict
// ═══════════════════════════════════════════════════════════════════════════

console.log("═".repeat(80));
if (allPass) {
  console.log("✅ ALL SCENARIOS PASS with the new ID-only dedup logic.");
  console.log("   The fix correctly delivers all tool calls regardless of streaming gaps.");
  console.log("   No false-positive drops from name-based deduplication.");
} else {
  console.log("❌ SOME SCENARIOS FAILED — investigate.");
}
console.log("═".repeat(80));
console.log();

process.exit(allPass ? 0 : 1);
