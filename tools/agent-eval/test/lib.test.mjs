import test from "node:test";
import assert from "node:assert/strict";
import { calculateApiEquivalent, normalizeTask, parseArgs } from "../src/lib.mjs";
import { buildImplementerPrompt, buildReviewerPrompt } from "../src/prompts.mjs";

const task = {
  id: "T-001",
  title: "Persistence test",
  baseRef: "master",
  requirement: "Persist the new field.",
  acceptanceCriteria: ["Survives reload"],
  requiredChecks: ["npm.cmd test"],
};

test("API-equivalent pricing does not bill cached tokens twice", () => {
  const value = calculateApiEquivalent({
    input_tokens: 1000,
    cached_input_tokens: 400,
    cache_write_input_tokens: 100,
    output_tokens: 200,
  }, {
    input: 10,
    cachedInput: 1,
    cacheWrite: 12.5,
    output: 50,
  });
  assert.equal(value, 0.01665);
});

test("task validation rejects empty acceptance criteria", () => {
  assert.throws(() => normalizeTask({ ...task, acceptanceCriteria: [] }), /acceptanceCriteria/);
});

test("both prompts carry the single-agent and secret rules", () => {
  const prompts = [buildImplementerPrompt(task), buildReviewerPrompt(task, "abc123")];
  for (const prompt of prompts) {
    assert.match(prompt, /서브에이전트/);
    assert.match(prompt, /API 키/);
    assert.match(prompt, /운영 데이터 변경을 하지 않는다/);
  }
});

test("argument parser keeps command and named arguments", () => {
  assert.deepEqual(parseArgs(["pipeline", "--task", "task.json", "--implementer", "claude"]), {
    _: ["pipeline"],
    task: "task.json",
    implementer: "claude",
  });
});
