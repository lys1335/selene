#!/usr/bin/env node
/**
 * test-parallel-agents.mjs
 *
 * Tests the ACTUAL bug scenario: multiple parallel Agent tool calls.
 *
 * The SDK handles Agent launches as subagent spawns. When the model emits
 * multiple Agent tool calls, the SDK may:
 * - Stream them all → no bug
 * - Stream only some → duplicateByName drops the rest
 * - Execute them concurrently with interleaved stream_events → index collision
 *
 * This script:
 * 1. Defines 4 lightweight agents
 * 2. Asks the model to launch all 4 in parallel
 * 3. Tracks stream_event vs assistant message tool_use blocks per parent_tool_use_id
 * 4. Simulates provider dedup logic
 *
 * Usage: node scripts/test-parallel-agents.mjs
 */

import { query as claudeAgentQuery } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// ─── Agent Definitions ──────────────────────────────────────────────────────
const agents = {
  "agent-alpha": {
    name: "Agent Alpha",
    description: "Returns a simple greeting",
    instructions: "Respond with exactly: 'Alpha reporting in.' Nothing else.",
    model: "claude-sonnet-4-6",
    tools: [],
  },
  "agent-beta": {
    name: "Agent Beta",
    description: "Returns a simple greeting",
    instructions: "Respond with exactly: 'Beta reporting in.' Nothing else.",
    model: "claude-sonnet-4-6",
    tools: [],
  },
  "agent-gamma": {
    name: "Agent Gamma",
    description: "Returns a simple greeting",
    instructions: "Respond with exactly: 'Gamma reporting in.' Nothing else.",
    model: "claude-sonnet-4-6",
    tools: [],
  },
  "agent-delta": {
    name: "Agent Delta",
    description: "Returns a simple greeting",
    instructions: "Respond with exactly: 'Delta reporting in.' Nothing else.",
    model: "claude-sonnet-4-6",
    tools: [],
  },
};

const PROMPT = `You have 4 agents available: agent-alpha, agent-beta, agent-gamma, agent-delta.

CRITICAL INSTRUCTION: Launch ALL 4 agents simultaneously in a SINGLE response.
You MUST emit 4 Agent tool calls in ONE assistant turn.
Do NOT launch them one at a time — launch all 4 in parallel.

Each agent should receive the prompt: "Report in."

After all agents respond, summarize their responses.`;

const MAX_TURNS = 10;

// ─── Tracking State ─────────────────────────────────────────────────────────
const streamedToolUseIds = new Set();
const streamedToolUseNames = new Set();
const streamEventToolCalls = [];
const assistantToolCalls = [];
const allMessages = [];

// Per-parent tracking (subagent context)
const toolCallsByParent = new Map(); // parent_tool_use_id → { stream: [], assistant: [] }

function isDictionary(obj) {
  return obj !== null && typeof obj === "object" && !Array.isArray(obj);
}

let currentParentToolUseId = null;

function processStreamEvent(message) {
  const event = message.event;
  const parentId = message.parent_tool_use_id || "root";

  if (!isDictionary(event) || typeof event.type !== "string") return;

  if (event.type === "content_block_start" && isDictionary(event.content_block)) {
    const block = event.content_block;
    if (block.type === "tool_use") {
      const toolId = block.id || "unknown";
      const toolName = block.name || "unknown";

      const entry = {
        id: toolId,
        name: toolName,
        index: event.index,
        parentToolUseId: parentId,
        source: "stream_event",
      };

      streamEventToolCalls.push(entry);
      streamedToolUseIds.add(toolId);
      streamedToolUseNames.add(toolName);

      if (!toolCallsByParent.has(parentId)) {
        toolCallsByParent.set(parentId, { stream: [], assistant: [] });
      }
      toolCallsByParent.get(parentId).stream.push(entry);

      console.log(`  [stream_event] parent=${parentId.slice(0, 12)}... tool_use id=${toolId.slice(-8)} name="${toolName}" index=${event.index}`);
    }
  }
}

function processAssistantMessage(message) {
  const content = message.message?.content;
  const parentId = message.parent_tool_use_id || "root";

  if (!Array.isArray(content)) return;

  const toolBlocks = content.filter(b => b?.type === "tool_use");
  const textBlocks = content.filter(b => b?.type === "text");

  if (textBlocks.length > 0) {
    const text = textBlocks.map(b => b.text).join(" ").slice(0, 120);
    console.log(`  [assistant] parent=${parentId === "root" ? "root" : parentId.slice(0, 12) + "..."} text: "${text}..."`);
  }

  for (const block of toolBlocks) {
    if (!block.id || !block.name) continue;

    const entry = {
      id: block.id,
      name: block.name,
      input: JSON.stringify(block.input ?? {}).slice(0, 100),
      parentToolUseId: parentId,
      source: "assistant",
    };

    assistantToolCalls.push(entry);

    if (!toolCallsByParent.has(parentId)) {
      toolCallsByParent.set(parentId, { stream: [], assistant: [] });
    }
    toolCallsByParent.get(parentId).assistant.push(entry);

    console.log(`  [assistant] parent=${parentId === "root" ? "root" : parentId.slice(0, 12) + "..."} tool_use id=${block.id.slice(-8)} name="${block.name}" input=${JSON.stringify(block.input ?? {}).slice(0, 60)}...`);
  }

  if (toolBlocks.length > 1) {
    console.log(`  ⚡ MULTI-CALL RESPONSE: ${toolBlocks.length} tool calls in single assistant message (parent=${parentId === "root" ? "root" : parentId.slice(0, 12) + "..."})`);
  }
}

// ─── Dedup Simulation ───────────────────────────────────────────────────────

function simulateProviderDedup() {
  console.log("\n" + "═".repeat(80));
  console.log("DEDUP SIMULATION");
  console.log("═".repeat(80));

  // Focus on root-level tool calls (the Agent launches)
  const rootStream = toolCallsByParent.get("root")?.stream || [];
  const rootAssistant = toolCallsByParent.get("root")?.assistant || [];

  console.log(`\nRoot-level stream_event tool calls: ${rootStream.length}`);
  console.log(`Root-level assistant tool calls: ${rootAssistant.length}`);

  // Count Agent-specific calls
  const agentStreamCalls = rootStream.filter(tc => tc.name === "Agent");
  const agentAssistantCalls = rootAssistant.filter(tc => tc.name === "Agent");

  console.log(`\nAgent calls in stream_event: ${agentStreamCalls.length}`);
  console.log(`Agent calls in assistant:     ${agentAssistantCalls.length}`);

  if (agentAssistantCalls.length === 0 && agentStreamCalls.length === 0) {
    console.log("\n⚠️  No Agent tool calls detected. The model may not have used the Agent tool.");
    console.log("   This could mean agents are defined but the model chose a different approach.\n");
    return false;
  }

  // Simulate the provider's dedup logic per-assistant-message
  const rootStreamIds = new Set(rootStream.map(tc => tc.id));
  const rootStreamNames = new Set(rootStream.map(tc => tc.name));

  let droppedByName = 0;
  let droppedById = 0;
  let emitted = 0;

  console.log("\n--- Simulating provider dedup on assistant tool_use blocks ---\n");

  for (const tc of rootAssistant) {
    const dupById = rootStreamIds.has(tc.id);
    const dupByName = rootStreamNames.has(tc.name);

    if (dupById) {
      console.log(`  ✓ SKIP (by ID)   id=...${tc.id.slice(-8)} name="${tc.name}"`);
      droppedById++;
    } else if (dupByName) {
      console.log(`  ✗ SKIP (by NAME) id=...${tc.id.slice(-8)} name="${tc.name}" — ⚠️ INCORRECTLY DROPPED`);
      droppedByName++;
    } else {
      console.log(`  → EMIT           id=...${tc.id.slice(-8)} name="${tc.name}"`);
      emitted++;
    }
  }

  console.log("\n" + "─".repeat(80));
  console.log("RESULTS:");
  console.log(`  Streamed (root):              ${rootStream.length}`);
  console.log(`  In assistant (root):          ${rootAssistant.length}`);
  console.log(`  Correctly skipped (by ID):    ${droppedById}`);
  console.log(`  INCORRECTLY dropped (by name): ${droppedByName}`);
  console.log(`  Emitted from fallback:        ${emitted}`);
  console.log(`  Total delivered to client:     ${rootStream.length + emitted}`);
  console.log(`  Expected:                     ${Math.max(rootStream.length, rootAssistant.length)}`);
  console.log("─".repeat(80));

  if (droppedByName > 0) {
    console.log("\n🐛 BUG CONFIRMED! duplicateByName dropped unique tool calls.");
    console.log(`   ${droppedByName} Agent calls with unique IDs were dropped because`);
    console.log(`   another Agent call was already seen in stream_event.\n`);
    return true;
  }

  // Check if all tools were streamed (the safe case)
  const assistantIdsNotStreamed = rootAssistant.filter(tc => !rootStreamIds.has(tc.id));
  if (assistantIdsNotStreamed.length === 0) {
    console.log("\n✅ All root tool calls were streamed via stream_event — no dedup issue in this run.");

    // But warn about the latent bug
    const nameCounts = {};
    for (const tc of rootAssistant) {
      nameCounts[tc.name] = (nameCounts[tc.name] || 0) + 1;
    }
    const duplicateNames = Object.entries(nameCounts).filter(([, c]) => c > 1);
    if (duplicateNames.length > 0) {
      console.log("   ⚠️  LATENT BUG: Multiple calls share the same name:");
      for (const [name, count] of duplicateNames) {
        console.log(`      "${name}" × ${count} — if any fail to stream, duplicateByName will drop them`);
      }
    }
    return false;
  }

  return false;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(80));
  console.log("Parallel Agent Launch Dedup Test");
  console.log("═".repeat(80));
  console.log(`Agents: ${Object.keys(agents).join(", ")}`);
  console.log(`Max turns: ${MAX_TURNS}`);
  console.log("═".repeat(80));
  console.log();

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    console.error("\n⏰ Timeout after 180s — aborting");
    abortController.abort();
  }, 180_000);

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
        agents,
      },
    });

    let assistantCount = 0;
    let messageCount = 0;
    const messageTypeCounts = {};

    for await (const message of q) {
      messageCount++;
      messageTypeCounts[message.type] = (messageTypeCounts[message.type] || 0) + 1;

      if (message.type === "stream_event") {
        processStreamEvent(message);
        continue;
      }

      if (message.type === "assistant") {
        assistantCount++;
        const parentId = message.parent_tool_use_id || "root";
        console.log(`\n── Assistant #${assistantCount} (parent=${parentId === "root" ? "root" : parentId.slice(0, 12) + "..."}) ──`);
        if (message.error) {
          console.error(`  ERROR: ${message.error}`);
        }
        processAssistantMessage(message);
        continue;
      }

      if (message.type === "result") {
        const r = message;
        console.log(`\n── Result ──`);
        console.log(`  Success: ${!r.is_error}`);
        console.log(`  Turns: ${r.num_turns}`);
        if (r.usage) {
          console.log(`  Tokens: in=${r.usage.input_tokens} out=${r.usage.output_tokens}`);
        }
        if (r.total_cost_usd !== undefined) {
          console.log(`  Cost: $${r.total_cost_usd.toFixed(4)}`);
        }
        if (r.is_error) {
          console.error(`  Errors: ${r.errors?.join(", ")}`);
        }
        continue;
      }

      if (message.type === "auth_status") {
        if (message.error) console.error(`  Auth error: ${message.error}`);
        continue;
      }
    }

    // ─── Analysis ───
    const bugConfirmed = simulateProviderDedup();

    // ─── Per-parent breakdown ───
    console.log("\n" + "═".repeat(80));
    console.log("PER-PARENT TOOL CALL BREAKDOWN");
    console.log("═".repeat(80));

    for (const [parentId, data] of toolCallsByParent) {
      const label = parentId === "root" ? "root (orchestrator)" : `subagent ${parentId.slice(0, 16)}...`;
      console.log(`\n  ${label}:`);
      console.log(`    stream_event: ${data.stream.length} tool calls`);
      for (const tc of data.stream) {
        console.log(`      id=...${tc.id.slice(-8)} name="${tc.name}" idx=${tc.index}`);
      }
      console.log(`    assistant:    ${data.assistant.length} tool calls`);
      for (const tc of data.assistant) {
        console.log(`      id=...${tc.id.slice(-8)} name="${tc.name}"`);
      }
    }

    // ─── Message type summary ───
    console.log(`\n  Total messages: ${messageCount}`);
    console.log(`  Type breakdown: ${JSON.stringify(messageTypeCounts, null, 2)}`);

    process.exit(bugConfirmed ? 1 : 0);

  } catch (err) {
    console.error("\n❌ Fatal error:", err.message);
    if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
    process.exit(2);
  } finally {
    clearTimeout(timeout);
  }
}

main();
