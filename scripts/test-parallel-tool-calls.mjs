#!/usr/bin/env node
/**
 * test-parallel-tool-calls.mjs
 *
 * Reproduces the "premature tool-call streaming" bug in the Claude Code provider.
 *
 * HYPOTHESIS: When the SDK emits multiple tool calls with the same name (e.g., 4x "Read"),
 * the provider's `duplicateByName` check in the assistant fallback path drops tool calls
 * 2–N because it sees the name was already streamed via `stream_event`.
 *
 * This script:
 * 1. Queries the Claude Agent SDK with a prompt designed to trigger 4+ parallel same-name tool calls
 * 2. Captures raw SDK messages (stream_event + assistant)
 * 3. Analyzes which tool_use blocks appear in each path
 * 4. Simulates the provider's dedup logic and reports what would be dropped
 *
 * Usage: node scripts/test-parallel-tool-calls.mjs
 */

import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// ─── Configuration ──────────────────────────────────────────────────────────
const PROMPT = `You MUST call multiple tools in parallel in a SINGLE response. Do NOT call them one at a time.

Read ALL 4 of these files simultaneously using 4 parallel Read tool calls in ONE response:
1. package.json
2. tsconfig.json
3. next.config.ts
4. tailwind.config.ts

CRITICAL: Emit all 4 Read tool calls in a SINGLE assistant turn. Do NOT read them sequentially.`;

const MAX_TURNS = 3;

// ─── Tracking State (mirrors provider's dedup logic) ────────────────────────
const streamedToolUseIds = new Set();     // IDs seen via stream_event
const streamedToolUseNames = new Set();   // Names seen via stream_event

// All tool calls seen via stream_event (with details)
const streamEventToolCalls = [];
// All tool calls seen via assistant message (with details)
const assistantToolCalls = [];
// All raw messages for debugging
const allMessages = [];

// ─── Message Processing ─────────────────────────────────────────────────────

function isDictionary(obj) {
  return obj !== null && typeof obj === "object" && !Array.isArray(obj);
}

function processStreamEvent(message) {
  const event = message.event;
  if (!isDictionary(event) || typeof event.type !== "string") return;

  if (event.type === "content_block_start" && isDictionary(event.content_block)) {
    const block = event.content_block;
    if (block.type === "tool_use") {
      const toolId = block.id || "unknown";
      const toolName = block.name || "unknown";

      streamEventToolCalls.push({
        id: toolId,
        name: toolName,
        index: event.index,
        source: "stream_event",
      });

      streamedToolUseIds.add(toolId);
      streamedToolUseNames.add(toolName);

      console.log(`  [stream_event] content_block_start: tool_use id=${toolId} name="${toolName}" index=${event.index}`);
    }
  }
}

function processAssistantMessage(message) {
  const content = message.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (!block?.type) continue;
    if (block.type === "tool_use" && block.id && block.name) {
      assistantToolCalls.push({
        id: block.id,
        name: block.name,
        input: JSON.stringify(block.input ?? {}).slice(0, 100),
        source: "assistant",
      });
      console.log(`  [assistant] tool_use id=${block.id} name="${block.name}" input=${JSON.stringify(block.input ?? {}).slice(0, 80)}...`);
    }
  }
}

// ─── Dedup Simulation ───────────────────────────────────────────────────────

function simulateProviderDedup() {
  console.log("\n" + "═".repeat(80));
  console.log("DEDUP SIMULATION (mimics claudecode-provider.ts lines 1518-1522)");
  console.log("═".repeat(80));

  console.log(`\nStreamed tool IDs (from stream_event):  [${[...streamedToolUseIds].join(", ")}]`);
  console.log(`Streamed tool Names (from stream_event): [${[...streamedToolUseNames].join(", ")}]`);

  console.log("\n--- Processing assistant message tool_use blocks ---\n");

  let emittedCount = 0;
  let droppedByIdCount = 0;
  let droppedByNameCount = 0;

  for (const tc of assistantToolCalls) {
    const duplicateById = streamedToolUseIds.has(tc.id);
    const duplicateByName = streamedToolUseNames.has(tc.name);

    if (duplicateById) {
      console.log(`  ✓ SKIP (by ID)   id=${tc.id} name="${tc.name}" — correctly skipped, was already streamed`);
      droppedByIdCount++;
    } else if (duplicateByName) {
      console.log(`  ✗ SKIP (by NAME) id=${tc.id} name="${tc.name}" — ⚠️  INCORRECTLY DROPPED! Different ID but same name was streamed`);
      droppedByNameCount++;
    } else {
      console.log(`  → EMIT           id=${tc.id} name="${tc.name}" — not seen before, would be emitted`);
      emittedCount++;
    }
  }

  console.log("\n" + "─".repeat(80));
  console.log("RESULTS:");
  console.log(`  Tool calls in stream_event:  ${streamEventToolCalls.length}`);
  console.log(`  Tool calls in assistant msg: ${assistantToolCalls.length}`);
  console.log(`  Correctly skipped (by ID):   ${droppedByIdCount}`);
  console.log(`  INCORRECTLY dropped (by name): ${droppedByNameCount}`);
  console.log(`  Emitted from fallback:       ${emittedCount}`);
  console.log(`  Total tool calls delivered:   ${streamEventToolCalls.length + emittedCount}`);
  console.log("─".repeat(80));

  if (droppedByNameCount > 0) {
    console.log("\n🐛 BUG CONFIRMED: duplicateByName dropped tool calls that had unique IDs!");
    console.log("   These tool calls were never streamed but were skipped because another");
    console.log("   tool call with the same name was seen in stream_event.");
    console.log("\n   FIX: Remove the duplicateByName check at claudecode-provider.ts:1519-1520");
    console.log("   and rely solely on duplicateById (line 1518).\n");
    return true;
  } else if (streamEventToolCalls.length === assistantToolCalls.length) {
    console.log("\n✅ All tool calls were streamed via stream_event.");
    console.log("   The assistant fallback correctly skipped all (by ID).");
    console.log("   In this run, the bug did NOT manifest — but it's still dangerous:");
    console.log("   if the SDK ever fails to stream some tool calls, duplicateByName would drop them.\n");

    // Still check if the NAME set would be problematic
    const uniqueNames = new Set(assistantToolCalls.map(tc => tc.name));
    const duplicateNameTools = assistantToolCalls.filter(tc => {
      const count = assistantToolCalls.filter(t => t.name === tc.name).length;
      return count > 1;
    });

    if (duplicateNameTools.length > 0) {
      console.log("   ⚠️  WARNING: Multiple tool calls share the same name:");
      for (const name of uniqueNames) {
        const count = assistantToolCalls.filter(t => t.name === name).length;
        if (count > 1) {
          console.log(`      "${name}" × ${count} calls`);
        }
      }
      console.log("   If ANY of these fail to stream, duplicateByName will incorrectly drop them.");
    }
    return false;
  } else {
    console.log("\n⚠️  Mismatch between stream and assistant tool call counts.");
    console.log("   Some tool calls may have been lost in streaming.\n");
    return false;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(80));
  console.log("Parallel Tool Call Dedup Test");
  console.log("═".repeat(80));
  console.log(`Prompt: ${PROMPT.slice(0, 100)}...`);
  console.log(`CWD: ${projectRoot}`);
  console.log(`Max turns: ${MAX_TURNS}`);
  console.log("═".repeat(80));
  console.log();

  const abortController = new AbortController();

  // Set a timeout to prevent hanging
  const timeout = setTimeout(() => {
    console.error("\n⏰ Timeout after 120s — aborting");
    abortController.abort();
  }, 120_000);

  try {
    const q = claudeAgentQuery({
      prompt: PROMPT,
      options: {
        abortController,
        cwd: projectRoot,
        executable: "node",
        pathToClaudeCodeExecutable: path.join(projectRoot, "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
        includePartialMessages: true,
        maxTurns: MAX_TURNS,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    });

    let turnCount = 0;
    let messageCount = 0;

    for await (const message of q) {
      messageCount++;
      allMessages.push({ type: message.type, messageIndex: messageCount });

      // ─── stream_event ───
      if (message.type === "stream_event") {
        processStreamEvent(message);
        continue;
      }

      // ─── assistant ───
      if (message.type === "assistant") {
        turnCount++;
        console.log(`\n── Assistant message #${turnCount} ──`);
        if (message.error) {
          console.error(`  ERROR: ${message.error}`);
        }
        processAssistantMessage(message);
        continue;
      }

      // ─── result ───
      if (message.type === "result") {
        console.log(`\n── Result ──`);
        console.log(`  Success: ${!message.is_error}`);
        console.log(`  Turns: ${message.num_turns}`);
        if (message.usage) {
          console.log(`  Tokens: in=${message.usage.input_tokens} out=${message.usage.output_tokens}`);
        }
        if (message.is_error) {
          console.error(`  Errors: ${message.errors?.join(", ")}`);
        }
        continue;
      }

      // ─── other message types ───
      if (message.type === "auth_status") {
        if (message.error) console.error(`  Auth error: ${message.error}`);
        continue;
      }

      // Log other types for debugging
      if (!["system", "tool_use_summary", "status", "tool_progress"].includes(message.type)) {
        console.log(`  [${message.type}]`);
      }
    }

    // ─── Analysis ───
    const bugConfirmed = simulateProviderDedup();

    // ─── Additional analysis: stream vs assistant coverage ───
    console.log("\n" + "═".repeat(80));
    console.log("DETAILED TOOL CALL COMPARISON");
    console.log("═".repeat(80));

    const streamIds = new Set(streamEventToolCalls.map(tc => tc.id));
    const assistantIds = new Set(assistantToolCalls.map(tc => tc.id));

    const onlyInStream = streamEventToolCalls.filter(tc => !assistantIds.has(tc.id));
    const onlyInAssistant = assistantToolCalls.filter(tc => !streamIds.has(tc.id));
    const inBoth = assistantToolCalls.filter(tc => streamIds.has(tc.id));

    console.log(`\nIn BOTH stream_event AND assistant: ${inBoth.length}`);
    for (const tc of inBoth) {
      console.log(`  id=${tc.id} name="${tc.name}"`);
    }

    console.log(`\nONLY in stream_event (not in assistant): ${onlyInStream.length}`);
    for (const tc of onlyInStream) {
      console.log(`  id=${tc.id} name="${tc.name}"`);
    }

    console.log(`\nONLY in assistant (not streamed): ${onlyInAssistant.length}`);
    for (const tc of onlyInAssistant) {
      console.log(`  id=${tc.id} name="${tc.name}" — ⚠️ Would be DROPPED by duplicateByName if name was streamed`);
    }

    console.log(`\nTotal raw SDK messages received: ${messageCount}`);
    console.log(`Message types: ${[...new Set(allMessages.map(m => m.type))].join(", ")}`);

    process.exit(bugConfirmed ? 1 : 0);

  } catch (err) {
    console.error("\n❌ Fatal error:", err.message);
    process.exit(2);
  } finally {
    clearTimeout(timeout);
  }
}

main();
