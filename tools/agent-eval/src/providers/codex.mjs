import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import { calculateApiEquivalent, cleanEnvironment, ensureDir, writeJson } from "../lib.mjs";

// 잠시 뒤 또는 다른 모델로는 성공할 수 있는 오류(용량 초과·과부하·속도 제한)만 폴백 대상으로 본다.
// 인증·설정·네트워크 오류는 모델을 바꿔도 같으므로 그대로 실패시킨다.
const CAPACITY_PATTERNS = [
  /at capacity/i,
  /overloaded/i,
  /rate[ _-]?limit/i,
  /too many requests/i,
  /\b429\b/,
  /\b503\b/,
  /temporarily unavailable/i,
  /insufficient[ _]capacity/i,
  /server is busy/i,
];

export function isCapacityError(error) {
  const text = `${error?.message ?? ""} ${error?.code ?? ""} ${error?.status ?? ""}`;
  return CAPACITY_PATTERNS.some((pattern) => pattern.test(text));
}

// 시도 순서: 역할별 기본 모델 → (허용 시) 프로필의 폴백 목록.
// 폴백 항목은 문자열(모델 ID)이거나 { model, reasoningEffort?, apiPricingPerMillion? } 이며,
// 생략된 값은 기본 모델의 것을 물려받는다. 검증자 전용 목록은 reviewerFallbackModels 로 따로 둘 수 있다.
export function buildModelAttempts(config, role, { allowFallback = false } = {}) {
  const primary = {
    model: role === "reviewer" ? (config.reviewerModel ?? config.model) : config.model,
    reasoningEffort: role === "reviewer"
      ? (config.reviewerReasoningEffort ?? config.reasoningEffort)
      : config.reasoningEffort,
    apiPricingPerMillion: config.apiPricingPerMillion,
    fallback: false,
  };
  if (!allowFallback) return [primary];
  const configured = (role === "reviewer" ? (config.reviewerFallbackModels ?? config.fallbackModels) : config.fallbackModels) ?? [];
  const fallbacks = configured.map((entry) => {
    const item = typeof entry === "string" ? { model: entry } : entry;
    if (!item || typeof item.model !== "string" || !item.model) {
      throw new Error("fallbackModels 항목은 모델 ID 문자열이거나 model 필드를 가진 객체여야 합니다");
    }
    return {
      model: item.model,
      reasoningEffort: item.reasoningEffort ?? primary.reasoningEffort,
      apiPricingPerMillion: item.apiPricingPerMillion ?? primary.apiPricingPerMillion,
      pricingInherited: item.apiPricingPerMillion == null,
      fallback: true,
    };
  }).filter((item) => item.model !== primary.model);
  return [primary, ...fallbacks];
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runCodex({ prompt, role, workspace, outputDir, config, timeoutMs, allowFallback = false }) {
  await ensureDir(outputDir);
  const startedAt = Date.now();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  const apiKey = process.env.OPENAI_API_KEY || undefined;
  const requestedMode = config.authMode ?? (apiKey ? "api" : "subscription");
  if (requestedMode === "api" && !apiKey) throw new Error("Codex authMode is api but OPENAI_API_KEY is missing");
  const attempts = buildModelAttempts(config, role, { allowFallback });
  const retryDelayMs = config.fallbackRetryDelayMs ?? 15_000;

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

  const failedAttempts = [];
  let thread;
  let turn;
  let used;
  try {
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      thread = codex.startThread({
        model: attempt.model,
        modelReasoningEffort: attempt.reasoningEffort,
        workingDirectory: workspace,
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
      });
      try {
        turn = await thread.run(prompt, { signal: abortController.signal });
        used = attempt;
        break;
      } catch (error) {
        const next = attempts[index + 1];
        if (!next || !isCapacityError(error) || abortController.signal.aborted) {
          if (failedAttempts.length) {
            error.message = `${error.message} (앞선 시도: ${failedAttempts.map((f) => `${f.model}: ${f.error}`).join("; ")})`;
          }
          throw error;
        }
        failedAttempts.push({
          model: attempt.model,
          reasoning_effort: attempt.reasoningEffort,
          error: error.message,
          failed_at: new Date().toISOString(),
        });
        console.warn(`[agent-eval] Codex ${attempt.model} 용량 초과 — ${retryDelayMs}ms 뒤 ${next.model}(${next.reasoningEffort}) 로 폴백합니다: ${error.message}`);
        await writeJson(path.join(outputDir, "fallback.json"), { attempts: failedAttempts, next_model: next.model });
        await sleep(retryDelayMs, abortController.signal);
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const usage = turn.usage;
  const equivalentCost = calculateApiEquivalent(usage, used.apiPricingPerMillion);
  const fallbackNote = used.fallback
    ? ` 기본 모델 ${attempts[0].model} 이 용량 초과라 폴백 모델 ${used.model}(${used.reasoningEffort}) 이 수행했다${used.pricingInherited ? "; 가격표는 기본 모델의 것을 그대로 썼다" : ""}.`
    : "";
  const record = {
    schema_version: 1,
    provider: "OpenAI",
    role,
    billing_mode: requestedMode,
    model_requested: attempts[0].model,
    model_used: used.model,
    models_used: [used.model],
    effort_requested: attempts[0].reasoningEffort,
    effort_used: used.reasoningEffort,
    model_fallback: used.fallback
      ? { used_model: used.model, used_effort: used.reasoningEffort, attempts: failedAttempts }
      : null,
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
    measurement_notes: (requestedMode === "subscription"
      ? "Subscription run has zero incremental cash charge. API-equivalent cost uses the configured public price table."
      : "API-equivalent cost is computed from measured tokens and configured public prices; reconcile with OpenAI project billing.") + fallbackNote,
  };
  await writeFile(path.join(outputDir, "final.txt"), turn.finalResponse ?? "", "utf8");
  await writeJson(path.join(outputDir, "items.json"), turn.items);
  await writeJson(path.join(outputDir, "record.json"), record);
  return { record, finalText: turn.finalResponse ?? "" };
}
