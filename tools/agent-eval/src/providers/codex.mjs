import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import { calculateApiEquivalent, cleanEnvironment, ensureDir, writeJson } from "../lib.mjs";

export async function runCodex({ prompt, role, workspace, outputDir, config, timeoutMs }) {
  await ensureDir(outputDir);
  const startedAt = Date.now();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  const apiKey = process.env.OPENAI_API_KEY || undefined;
  const requestedMode = config.authMode ?? (apiKey ? "api" : "subscription");
  const model = role === "reviewer" ? (config.reviewerModel ?? config.model) : config.model;
  const reasoningEffort = role === "reviewer"
    ? (config.reviewerReasoningEffort ?? config.reasoningEffort)
    : config.reasoningEffort;
  if (requestedMode === "api" && !apiKey) throw new Error("Codex authMode is api but OPENAI_API_KEY is missing");

  const codex = new Codex({
    apiKey: requestedMode === "api" ? apiKey : undefined,
    env: cleanEnvironment({
      CODEX_HOME: process.env.CODEX_HOME ?? "",
      DATABASE_URL: process.env.FISCUS_EVAL_DATABASE_URL ?? "",
    }, ["ANTHROPIC_API_KEY", "FISCUS_EVAL_DATABASE_URL", "OPENAI_API_KEY"]),
    config: {
      approvals_reviewer: "auto_review",
      features: {
        multi_agent: false,
        multi_agent_v2: false,
      },
    },
  });
  const thread = codex.startThread({
    model,
    modelReasoningEffort: reasoningEffort,
    workingDirectory: workspace,
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });

  let turn;
  try {
    turn = await thread.run(prompt, { signal: abortController.signal });
  } finally {
    clearTimeout(timeout);
  }

  const usage = turn.usage;
  const equivalentCost = calculateApiEquivalent(usage, config.apiPricingPerMillion);
  const record = {
    schema_version: 1,
    provider: "OpenAI",
    role,
    billing_mode: requestedMode,
    model_requested: model,
    models_used: [model],
    effort_requested: reasoningEffort,
    status: "success",
    input_tokens: usage?.input_tokens ?? null,
    cached_input_tokens: usage?.cached_input_tokens ?? null,
    cache_write_input_tokens: usage?.cache_write_input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    reasoning_output_tokens: usage?.reasoning_output_tokens ?? null,
    reported_cost_usd: null,
    reported_cost_kind: null,
    incremental_cash_cost_usd: requestedMode === "subscription" ? 0 : null,
    api_equivalent_cost_usd: equivalentCost,
    duration_ms: null,
    duration_api_ms: null,
    wall_duration_ms: Date.now() - startedAt,
    agent_turns: 1,
    session_id: thread.id,
    subagents_policy: "disabled",
    subagents_used: false,
    model_usage: usage,
    event_count: turn.items.length,
    measurement_source: "Codex SDK Turn.usage",
    measurement_notes: requestedMode === "subscription"
      ? "Subscription run has zero incremental cash charge. API-equivalent cost uses the configured public price table."
      : "API-equivalent cost is computed from measured tokens and configured public prices; reconcile with OpenAI project billing.",
  };
  await writeFile(path.join(outputDir, "final.txt"), turn.finalResponse ?? "", "utf8");
  await writeJson(path.join(outputDir, "items.json"), turn.items);
  await writeJson(path.join(outputDir, "record.json"), record);
  return { record, finalText: turn.finalResponse ?? "" };
}
