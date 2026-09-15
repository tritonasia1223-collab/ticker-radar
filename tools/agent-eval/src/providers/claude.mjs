import { writeFile } from "node:fs/promises";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { appendJsonLine, cleanEnvironment, ensureDir, writeJson } from "../lib.mjs";

function sumModelUsage(modelUsage = {}) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  for (const usage of Object.values(modelUsage)) {
    totals.input_tokens += usage.inputTokens ?? 0;
    totals.output_tokens += usage.outputTokens ?? 0;
    totals.cache_read_tokens += usage.cacheReadInputTokens ?? 0;
    totals.cache_write_tokens += usage.cacheCreationInputTokens ?? 0;
  }
  return totals;
}

export async function runClaude({ prompt, role, workspace, outputDir, config, timeoutMs }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not available to the experiment runner");
  await ensureDir(outputDir);
  const eventsPath = path.join(outputDir, "events.jsonl");
  const startedAt = Date.now();
  let result = null;
  let finalText = "";
  let eventCount = 0;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  const tools = role === "reviewer"
    ? ["Read", "Glob", "Grep", "Bash"]
    : ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

  try {
    const stream = query({
      prompt,
      options: {
        abortController,
        cwd: workspace,
        model: config.model,
        effort: config.effort,
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
        permissionMode: "dontAsk",
        tools,
        allowedTools: tools,
        disallowedTools: ["Agent", "Task"],
        settingSources: ["project"],
        persistSession: true,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "This is a controlled single-agent evaluation. Never create or invoke subagents, Agent, or Task tools.",
          snapshot: true,
        },
        env: cleanEnvironment({
          CLAUDE_AGENT_SDK_CLIENT_APP: "fiscus-agent-eval/0.1.0",
          CLAUDE_CODE_DISABLE_AGENT_VIEW: "1",
          DATABASE_URL: process.env.FISCUS_EVAL_DATABASE_URL ?? "",
        }, ["OPENAI_API_KEY", "FISCUS_EVAL_DATABASE_URL"]),
      },
    });

    for await (const message of stream) {
      eventCount += 1;
      await appendJsonLine(eventsPath, message);
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text") finalText += `${block.text}\n`;
        }
      }
      if (message.type === "result") result = message;
    }
  } finally {
    clearTimeout(timeout);
  }

  if (!result) throw new Error("Claude run ended without a result message");
  if (result.subtype === "success" && typeof result.result === "string") finalText = result.result;
  const usage = sumModelUsage(result.modelUsage);
  const record = {
    schema_version: 1,
    provider: "Anthropic",
    role,
    billing_mode: "api",
    model_requested: config.model,
    models_used: Object.keys(result.modelUsage ?? {}),
    effort_requested: config.effort,
    status: result.subtype,
    input_tokens: usage.input_tokens,
    cached_input_tokens: usage.cache_read_tokens,
    cache_write_input_tokens: usage.cache_write_tokens,
    output_tokens: usage.output_tokens,
    reasoning_output_tokens: null,
    reported_cost_usd: result.total_cost_usd,
    reported_cost_kind: "client_side_estimate",
    incremental_cash_cost_usd: null,
    api_equivalent_cost_usd: result.total_cost_usd,
    duration_ms: result.duration_ms,
    duration_api_ms: result.duration_api_ms,
    wall_duration_ms: Date.now() - startedAt,
    agent_turns: result.num_turns,
    session_id: result.session_id,
    subagents_policy: "disabled",
    subagents_used: false,
    model_usage: result.modelUsage ?? null,
    event_count: eventCount,
    measurement_source: "Claude Agent SDK result.modelUsage and result.total_cost_usd",
    measurement_notes: "Token counts are measured. USD fields reported by the SDK are client-side estimates and must be reconciled with Anthropic billing.",
  };
  await writeFile(path.join(outputDir, "final.txt"), finalText, "utf8");
  await writeJson(path.join(outputDir, "record.json"), record);
  return { record, finalText };
}
