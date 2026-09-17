import test from "node:test";
import assert from "node:assert/strict";
import { buildModelAttempts, isCapacityError } from "../src/providers/codex.mjs";

const config = {
  model: "gpt-6-astra",
  reasoningEffort: "ultra",
  reviewerModel: "gpt-6-astra",
  reviewerReasoningEffort: "ultra",
  apiPricingPerMillion: { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
  fallbackModels: [
    { model: "gpt-5.6-sol", reasoningEffort: "ultra" },
    "gpt-5.6-terra",
  ],
};

test("용량 초과·과부하·속도 제한만 폴백 대상으로 본다", () => {
  assert.equal(isCapacityError(new Error("Selected model is at capacity. Please try a different model.")), true);
  assert.equal(isCapacityError(new Error("429 Too Many Requests")), true);
  assert.equal(isCapacityError(new Error("The engine is currently overloaded")), true);
  assert.equal(isCapacityError(Object.assign(new Error("boom"), { status: 503 })), true);
  assert.equal(isCapacityError(new Error("Codex authMode is api but OPENAI_API_KEY is missing")), false);
  assert.equal(isCapacityError(new Error("getaddrinfo ENOTFOUND api.openai.com")), false);
  assert.equal(isCapacityError(new Error("aborted")), false);
  assert.equal(isCapacityError(null), false);
});

test("폴백을 허용하지 않으면 기본 모델 한 번만 시도한다(벤치마크 모드)", () => {
  const attempts = buildModelAttempts(config, "reviewer", { allowFallback: false });
  assert.deepEqual(attempts.map((a) => a.model), ["gpt-6-astra"]);
  assert.equal(attempts[0].fallback, false);
  assert.deepEqual(buildModelAttempts(config, "reviewer").map((a) => a.model), ["gpt-6-astra"]);
});

test("폴백 허용 시 기본 → 목록 순서로 시도하고 생략된 값은 기본 모델에서 물려받는다", () => {
  const attempts = buildModelAttempts(config, "reviewer", { allowFallback: true });
  assert.deepEqual(attempts.map((a) => a.model), ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra"]);
  assert.deepEqual(attempts.map((a) => a.reasoningEffort), ["ultra", "ultra", "ultra"]);
  assert.deepEqual(attempts.map((a) => a.fallback), [false, true, true]);
  assert.equal(attempts[2].pricingInherited, true);
  assert.deepEqual(attempts[2].apiPricingPerMillion, config.apiPricingPerMillion);
});

test("검증자 전용 폴백 목록이 우선하고, 기본 모델과 같은 항목은 건너뛴다", () => {
  const withReviewerList = {
    ...config,
    reviewerFallbackModels: [{ model: "gpt-6-astra" }, { model: "gpt-5.6-luna", reasoningEffort: "max", apiPricingPerMillion: { input: 1, cachedInput: 0.1, cacheWrite: 1, output: 5 } }],
  };
  const reviewer = buildModelAttempts(withReviewerList, "reviewer", { allowFallback: true });
  assert.deepEqual(reviewer.map((a) => a.model), ["gpt-6-astra", "gpt-5.6-luna"]);
  assert.equal(reviewer[1].reasoningEffort, "max");
  assert.equal(reviewer[1].pricingInherited, false);
  const implementer = buildModelAttempts(withReviewerList, "implementer", { allowFallback: true });
  assert.deepEqual(implementer.map((a) => a.model), ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra"]);
});

test("폴백 목록이 없으면 기본 모델만 시도하고, 잘못된 항목은 거부한다", () => {
  const { fallbackModels, ...noFallback } = config;
  assert.deepEqual(buildModelAttempts(noFallback, "reviewer", { allowFallback: true }).map((a) => a.model), ["gpt-6-astra"]);
  assert.throws(() => buildModelAttempts({ ...config, fallbackModels: [{ reasoningEffort: "high" }] }, "reviewer", { allowFallback: true }), /model 필드/);
});
