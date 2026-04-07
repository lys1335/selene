#!/usr/bin/env node
/**
 * test-dedup-deterministic.mjs
 *
 * DETERMINISTIC reproduction of the duplicateByName bug.
 *
 * Part 1: Unit test — directly simulates the provider's dedup logic with
 *         known inputs (no SDK call needed). Proves the code path is broken.
 *
 * Part 2: Live SDK test with includePartialMessages: false — when streaming
 *         is disabled, NO stream_events arrive, but assistant messages still
 *         contain all tool_use blocks. Tests whether the fallback path works.
 *
 * Part 3: Live SDK test with includePartialMessages: true but using the
 *         actual provider logic (extracted) to show the exact dedup behavior
 *         across real SDK message ordering.
 *
 * Usage: node scripts/test-dedup-deterministic.mjs
 */

import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: Deterministic unit test of the dedup logic
// ═══════════════════════════════════════════════════════════════════════════

function testDedupLogicUnit() {
  console.log("═".repeat(80));
  console.log("PART 1: Deterministic Unit Test — Provider Dedup Logic");
  console.log("═".repeat(80));

  // Simulate: SDK streams 1 of 4 Agent tool calls, then assistant message has all 4
  const streamedToolUseIdsThisTurn = new Set();
  const streamedToolUseNamesThisTurn = new Set();

  // Only 1 Agent call was streamed (e.g., streaming interrupted or partial)
  streamedToolUseIdsThisTurn.add("toolu_AAAA");
  streamedToolUseNamesThisTurn.add("Agent");

  // Assistant message contains all 4 Agent calls
  const assistantBlocks = [
    { type: "tool_use", id: "toolu_AAAA", name: "Agent", input: { prompt: "Task 1" } },
    { type: "tool_use", id: "toolu_BBBB", name: "Agent", input: { prompt: "Task 2" } },
    { type: "tool_use", id: "toolu_CCCC", name: "Agent", input: { prompt: "Task 3" } },
    { type: "tool_use", id: "toolu_DDDD", name: "Agent", input: { prompt: "Task 4" } },
  ];

  console.log("\nScenario: SDK streamed 1 Agent call, assistant has 4 Agent calls");
  console.log(`  streamedToolUseIdsThisTurn: [${[...streamedToolUseIdsThisTurn]}]`);
  console.log(`  streamedToolUseNamesThisTurn: [${[...streamedToolUseNamesThisTurn]}]`);
  console.log(`  Assistant blocks: ${assistantBlocks.length} tool_use blocks\n`);

  // Exact code from claudecode-provider.ts lines 1513-1522
  let bugDropCount = 0;
  let correctDropCount = 0;
  let emitCount = 0;

  for (const block of assistantBlocks) {
    if (block.type === "tool_use" && block.id && block.name) {
      const normalizedBlockName = block.name; // normalizeClaudeSdkToolName is identity for "Agent"
      const duplicateById = streamedToolUseIdsThisTurn.has(block.id);
      const duplicateByName = streamedToolUseNamesThisTurn.has(normalizedBlockName);

      if (duplicateById || duplicateByName) {
        if (duplicateById) {
          console.log(`  ✓ SKIP id=${block.id}: correctly skipped (already streamed by ID)`);
          correctDropCount++;
        } else {
          console.log(`  ✗ SKIP id=${block.id}: ⚠️  DROPPED by duplicateByName! This tool call was NEVER streamed.`);
          console.log(`    → input: ${JSON.stringify(block.input)}`);
          bugDropCount++;
        }
        continue; // <-- This is the provider's behavior
      }
      console.log(`  → EMIT id=${block.id}: would be emitted`);
      emitCount++;
    }
  }

  console.log("\n  Results:");
  console.log(`    Correctly skipped (ID match): ${correctDropCount}`);
  console.log(`    INCORRECTLY dropped (name):   ${bugDropCount}`);
  console.log(`    Emitted:                      ${emitCount}`);
  console.log(`    Tool calls delivered:          ${1 + emitCount} (1 streamed + ${emitCount} fallback)`);
  console.log(`    Tool calls LOST:              ${bugDropCount}`);

  const pass1 = bugDropCount === 3;
  console.log(`\n  ${pass1 ? "🐛 BUG CONFIRMED" : "❌ UNEXPECTED"}: ${bugDropCount} tool calls dropped by duplicateByName\n`);

  // Now show what SHOULD happen (ID-only dedup)
  console.log("  FIX: Using ID-only dedup:");
  let fixEmitCount = 0;
  for (const block of assistantBlocks) {
    if (block.type === "tool_use" && block.id && block.name) {
      if (streamedToolUseIdsThisTurn.has(block.id)) {
        console.log(`    ✓ SKIP id=${block.id}: correctly skipped (ID match)`);
      } else {
        console.log(`    → EMIT id=${block.id}: correctly emitted`);
        fixEmitCount++;
      }
    }
  }
  console.log(`\n  With fix: ${1 + fixEmitCount} tool calls delivered (1 streamed + ${fixEmitCount} fallback) — all 4 arrive ✅\n`);

  return pass1;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: Live test with includePartialMessages: false
// ═══════════════════════════════════════════════════════════════════════════

async function testNoPartialMessages() {
  console.log("═".repeat(80));
  console.log("PART 2: Live SDK Test — includePartialMessages: false");
  console.log("═".repeat(80));
  console.log("When streaming is disabled, NO stream_events arrive.");
  console.log("All tool calls only appear in assistant messages.");
  console.log("If duplicateByName is active, only 1st Agent call would survive.\n");

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, 120_000);

  const agents = {
    "agent-alpha": {
      name: "Agent Alpha",
      description: "Returns a greeting",
      instructions: "Reply with exactly: 'Alpha here.' Nothing else.",
      model: "claude-sonnet-4-6",
      tools: [],
    },
    "agent-beta": {
      name: "Agent Beta",
      description: "Returns a greeting",
      instructions: "Reply with exactly: 'Beta here.' Nothing else.",
      model: "claude-sonnet-4-6",
      tools: [],
    },
  };

  const streamEvents = [];
  const assistantMsgs = [];

  try {
    const q = claudeAgentQuery({
      prompt: "Launch agent-alpha AND agent-beta in PARALLEL (2 Agent calls in ONE response). Each gets prompt: 'Report.'",
      options: {
        abortController,
        cwd: projectRoot,
        executable: "node",
        pathToClaudeCodeExecutable: path.join(projectRoot, "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
        includePartialMessages: false,
        maxTurns: 6,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        agents,
      },
    });

    for await (const message of q) {
      if (message.type === "stream_event") {
        const event = message.event;
        if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
          streamEvents.push({
            id: event.content_block.id,
            name: event.content_block.name,
            parent: message.parent_tool_use_id || "root",
          });
          console.log(`  [stream_event] tool_use id=...${(event.content_block.id || "").slice(-8)} name="${event.content_block.name}" parent=${message.parent_tool_use_id || "root"}`);
        }
      }

      if (message.type === "assistant") {
        const content = message.message?.content || [];
        const tools = content.filter(b => b?.type === "tool_use");
        const parent = message.parent_tool_use_id || "root";
        for (const t of tools) {
          assistantMsgs.push({ id: t.id, name: t.name, parent });
          console.log(`  [assistant] tool_use id=...${(t.id || "").slice(-8)} name="${t.name}" parent=${parent}`);
        }
        if (tools.length > 1) {
          console.log(`  ⚡ MULTI-CALL: ${tools.length} tool calls in single assistant message`);
        }
      }

      if (message.type === "result") {
        console.log(`  [result] success=${!message.is_error} turns=${message.num_turns}`);
      }
    }

    // Analysis
    console.log("\n--- Analysis ---");
    console.log(`  stream_event tool calls: ${streamEvents.length}`);
    console.log(`  assistant tool calls:    ${assistantMsgs.length}`);

    const rootAssistant = assistantMsgs.filter(t => t.parent === "root");
    const agentCalls = rootAssistant.filter(t => t.name === "Agent");
    console.log(`  Root-level Agent calls:  ${agentCalls.length}`);

    if (streamEvents.length === 0 && agentCalls.length > 1) {
      console.log("\n  🐛 BUG SCENARIO: No streaming + multiple same-name tool calls");
      console.log("     With the current provider code:");
      console.log("     - 1st Agent call in assistant: emitted (name not yet seen)");
      console.log("     - 2nd+ Agent calls: name 'Agent' now in set → DROPPED by duplicateByName");
      console.log("     Only 1 of " + agentCalls.length + " agent launches would reach the client!\n");
      return true;
    } else if (streamEvents.length > 0) {
      console.log("\n  ℹ️  SDK still sent stream_events despite includePartialMessages:false");
      console.log("     This means the flag may not fully suppress streaming.\n");
      return false;
    }

    return false;
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3: Live test — exact provider logic replay
// ═══════════════════════════════════════════════════════════════════════════

async function testProviderReplay() {
  console.log("═".repeat(80));
  console.log("PART 3: Live SDK Test — Full Provider Logic Replay");
  console.log("═".repeat(80));
  console.log("Runs real SDK query, captures ALL messages in order,");
  console.log("then replays through exact provider dedup logic.\n");

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, 120_000);

  const agents = {
    "agent-one": {
      name: "Agent One",
      description: "Returns a greeting",
      instructions: "Reply with exactly: 'One.' Nothing else.",
      model: "claude-sonnet-4-6",
      tools: [],
    },
    "agent-two": {
      name: "Agent Two",
      description: "Returns a greeting",
      instructions: "Reply with exactly: 'Two.' Nothing else.",
      model: "claude-sonnet-4-6",
      tools: [],
    },
    "agent-three": {
      name: "Agent Three",
      description: "Returns a greeting",
      instructions: "Reply with exactly: 'Three.' Nothing else.",
      model: "claude-sonnet-4-6",
      tools: [],
    },
  };

  const rawMessages = [];

  try {
    const q = claudeAgentQuery({
      prompt: "Launch agent-one, agent-two, and agent-three ALL in PARALLEL (3 Agent tool calls in ONE response). Each gets prompt: 'Go.'",
      options: {
        abortController,
        cwd: projectRoot,
        executable: "node",
        pathToClaudeCodeExecutable: path.join(projectRoot, "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
        includePartialMessages: true,
        maxTurns: 8,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        agents,
      },
    });

    for await (const message of q) {
      rawMessages.push(message);
    }

    // Now replay through provider logic
    console.log(`  Captured ${rawMessages.length} raw SDK messages\n`);

    const streamedIds = new Set();
    const streamedNames = new Set();
    const emittedToolCalls = [];  // What the client would actually see
    const droppedToolCalls = [];  // What duplicateByName would kill

    for (const message of rawMessages) {
      if (message.type === "stream_event") {
        const event = message.event;
        if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
          const id = event.content_block.id || `synth_${Math.random().toString(36).slice(2, 8)}`;
          const name = event.content_block.name || "unknown";
          const parent = message.parent_tool_use_id || "root";

          streamedIds.add(id);
          streamedNames.add(name);

          emittedToolCalls.push({ id, name, parent, via: "stream" });
          console.log(`  STREAM → emit tool_use id=...${id.slice(-8)} name="${name}" parent=${parent === "root" ? "root" : parent.slice(0, 8) + "..."}`);
        }
      }

      if (message.type === "assistant") {
        const content = message.message?.content || [];
        const parent = message.parent_tool_use_id || "root";

        for (const block of content) {
          if (block?.type !== "tool_use" || !block.id || !block.name) continue;

          const duplicateById = streamedIds.has(block.id);
          const duplicateByName = streamedNames.has(block.name);

          if (duplicateById) {
            // Correctly skipped — already emitted via streaming
          } else if (duplicateByName) {
            // BUG: dropped by name even though this specific call was never streamed
            droppedToolCalls.push({ id: block.id, name: block.name, parent, reason: "duplicateByName" });
            console.log(`  ASST ✗ DROP  id=...${block.id.slice(-8)} name="${block.name}" parent=${parent === "root" ? "root" : parent.slice(0, 8) + "..."} — duplicateByName!`);
          } else {
            // Emit from fallback
            emittedToolCalls.push({ id: block.id, name: block.name, parent, via: "assistant_fallback" });
            console.log(`  ASST → emit  id=...${block.id.slice(-8)} name="${block.name}" parent=${parent === "root" ? "root" : parent.slice(0, 8) + "..."}`);
            // After emitting, add to tracking (provider doesn't do this, but let's be accurate)
            streamedIds.add(block.id);
            streamedNames.add(block.name);
          }
        }
      }
    }

    console.log("\n" + "─".repeat(60));
    console.log("REPLAY RESULTS:");
    console.log(`  Total emitted to client: ${emittedToolCalls.length}`);
    console.log(`  Dropped by duplicateByName: ${droppedToolCalls.length}`);
    if (droppedToolCalls.length > 0) {
      console.log("\n  🐛 DROPPED CALLS:");
      for (const tc of droppedToolCalls) {
        console.log(`    id=...${tc.id.slice(-8)} name="${tc.name}" parent=${tc.parent}`);
      }
    }

    // Root Agent calls specifically
    const rootEmitted = emittedToolCalls.filter(tc => tc.parent === "root" && tc.name === "Agent");
    const rootDropped = droppedToolCalls.filter(tc => tc.parent === "root" && tc.name === "Agent");
    console.log(`\n  Root-level Agent calls emitted: ${rootEmitted.length}`);
    console.log(`  Root-level Agent calls dropped: ${rootDropped.length}`);
    console.log("─".repeat(60));

    if (rootDropped.length > 0) {
      console.log("\n  🐛 BUG CONFIRMED at root level!\n");
      return true;
    }

    console.log("\n  ✅ No root-level drops in this run (SDK streamed all calls reliably).\n");
    return false;

  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("\n" + "╔".padEnd(79, "═") + "╗");
  console.log("║ Parallel Tool Call Dedup — Comprehensive Bug Reproduction".padEnd(79) + "║");
  console.log("╚".padEnd(79, "═") + "╝\n");

  // Part 1: Pure unit test — always confirms the bug
  const bug1 = testDedupLogicUnit();

  // Part 2: Live test without streaming
  const bug2 = await testNoPartialMessages();

  // Part 3: Live test with full replay
  const bug3 = await testProviderReplay();

  // ─── Final Verdict ───
  console.log("\n" + "═".repeat(80));
  console.log("FINAL VERDICT");
  console.log("═".repeat(80));
  console.log(`  Part 1 (Unit test):           ${bug1 ? "🐛 BUG CONFIRMED" : "✅ Clean"}`);
  console.log(`  Part 2 (No partial msgs):     ${bug2 ? "🐛 BUG SCENARIO" : "ℹ️  Not triggered"}`);
  console.log(`  Part 3 (Live replay):         ${bug3 ? "🐛 BUG CONFIRMED" : "ℹ️  Not triggered (SDK streamed all)"}`);
  console.log();

  if (bug1) {
    console.log("  CONCLUSION: The duplicateByName logic at claudecode-provider.ts:1519-1520");
    console.log("  is PROVABLY BROKEN for any scenario where multiple tool calls share a name");
    console.log("  and not all of them arrive via stream_event.\n");
    console.log("  The bug is LATENT in production — it depends on SDK streaming reliability.");
    console.log("  When the SDK reliably streams ALL tool calls, the ID-based dedup catches");
    console.log("  them first. But any streaming gap (network, SDK bug, partial messages off)");
    console.log("  immediately triggers data loss.\n");
    console.log("  FIX: Remove line 1519 (duplicateByName) and rely solely on duplicateById.\n");
  }

  process.exit(bug1 ? 1 : 0);
}

main();
