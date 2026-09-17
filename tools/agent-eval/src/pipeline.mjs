import path from "node:path";
import { cp, readFile, writeFile } from "node:fs/promises";
import { buildImplementerPrompt, buildReviewerPrompt } from "./prompts.mjs";
import { runClaude } from "./providers/claude.mjs";
import { runCodex } from "./providers/codex.mjs";
import { addWorktree, bootstrapWorkspace, captureGitState, commitCandidate, resolveRef, runChecks } from "./workspace.mjs";
import { ensureDir, extractVerdict, runFile, safeId, timestamp, writeJson } from "./lib.mjs";

const providers = {
  claude: runClaude,
  codex: runCodex,
};

async function buildExecutionMetadata(repoRoot, config) {
  const [head, status] = await Promise.all([
    runFile("git", ["-C", repoRoot, "rev-parse", "HEAD"]),
    runFile("git", ["-C", repoRoot, "status", "--porcelain=v1"]),
  ]);
  return {
    profile_id: config.profileId ?? null,
    node_version: process.version,
    platform: `${process.platform}-${process.arch}`,
    runner_head_sha: head.exitCode === 0 ? head.stdout.trim() : null,
    runner_dirty: status.exitCode === 0 ? status.stdout.trim() !== "" : null,
    requested_models: {
      claude_implementer: config.providers.claude.model,
      claude_reviewer: config.providers.claude.reviewerModel ?? config.providers.claude.model,
      codex_implementer: config.providers.codex.model,
      codex_reviewer: config.providers.codex.reviewerModel ?? config.providers.codex.model,
    },
  };
}

// allowFallback: 용량 초과 시 프로필의 fallbackModels 로 넘어갈지. 벤치마크(pipeline·run)는 모델 고정이 목적이라 false,
// 변경 검증(review)만 true.
async function executeProvider({ provider, role, prompt, workspace, outputDir, config, timeoutMs, allowFallback = false }) {
  const runner = providers[provider];
  if (!runner) throw new Error(`Unknown provider: ${provider}`);
  const before = await captureGitState(workspace);
  await writeJson(path.join(outputDir, "git-before.json"), before);
  let outcome;
  try {
    outcome = await runner({
      prompt,
      role,
      workspace,
      outputDir,
      config: config.providers[provider],
      timeoutMs,
      allowFallback,
    });
  } catch (error) {
    await writeJson(path.join(outputDir, "error.json"), {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
  const after = await captureGitState(workspace);
  await writeJson(path.join(outputDir, "git-after.json"), after);
  const sourceChanged = role === "reviewer" && after.status.trim() !== before.status.trim();
  outcome.record.protocol_source_changed = sourceChanged;
  await writeJson(path.join(outputDir, "record.json"), outcome.record);
  return outcome;
}

export async function runSingle({ provider, role, prompt, workspace, outputDir, config }) {
  const timeoutMs = config.limits.runTimeoutMinutes * 60_000;
  return executeProvider({ provider, role, prompt, workspace, outputDir, config, timeoutMs });
}

export async function runPipeline({ repoRoot, task, implementer, config, taskFile }) {
  if (!providers[implementer]) throw new Error("--implementer must be claude or codex");
  if (task.requiresEvaluationDatabase && !process.env.FISCUS_EVAL_DATABASE_URL) {
    throw new Error("This task requires the isolated evaluation database, but FISCUS_EVAL_DATABASE_URL is missing");
  }
  const baseSha = await resolveRef(repoRoot, task.baseRef);
  const runId = `${safeId(task.id)}-${implementer}-${timestamp()}`;
  const runRoot = path.join(config.runtimeRoot, "runs", runId);
  const workspacesRoot = path.join(runRoot, "workspaces");
  const resultsRoot = path.join(runRoot, "results");
  const timeoutMs = config.limits.runTimeoutMinutes * 60_000;
  await ensureDir(workspacesRoot);
  await ensureDir(resultsRoot);
  await cp(taskFile, path.join(runRoot, "task.json"));

  const manifest = {
    schema_version: 1,
    run_id: runId,
    task_id: task.id,
    implementer,
    reviewers: ["claude", "codex"],
    repo_root: repoRoot,
    base_ref: task.baseRef,
    base_sha: baseSha,
    started_at: new Date().toISOString(),
    status: "running",
    execution: await buildExecutionMetadata(repoRoot, config),
  };
  await writeJson(path.join(runRoot, "manifest.json"), manifest);
  let estimatedPipelineCost = 0;
  const accountForCost = async (outcome) => {
    const value = outcome.record.api_equivalent_cost_usd;
    if (typeof value === "number") estimatedPipelineCost += value;
    manifest.api_equivalent_cost_usd_so_far = Number(estimatedPipelineCost.toFixed(8));
    await writeJson(path.join(runRoot, "manifest.json"), manifest);
    if (estimatedPipelineCost > config.limits.pipelineBudgetUsd) {
      throw new Error(`Pipeline API-equivalent budget exceeded: $${estimatedPipelineCost.toFixed(4)} > $${config.limits.pipelineBudgetUsd}`);
    }
  };

  const implementationWorkspace = path.join(workspacesRoot, `implement-${implementer}`);
  await addWorktree(repoRoot, implementationWorkspace, baseSha);
  await bootstrapWorkspace(
    implementationWorkspace,
    config.workspace.bootstrapCommands,
    path.join(resultsRoot, "bootstrap-implementer"),
    timeoutMs,
  );
  const implementationOutput = path.join(resultsRoot, `implement-${implementer}`);
  const implementationResult = await executeProvider({
    provider: implementer,
    role: "implementer",
    prompt: buildImplementerPrompt(task),
    workspace: implementationWorkspace,
    outputDir: implementationOutput,
    config,
    timeoutMs,
  });
  await accountForCost(implementationResult);
  const checkResults = await runChecks(
    implementationWorkspace,
    task.requiredChecks,
    path.join(resultsRoot, "objective-checks"),
    timeoutMs,
  );
  const candidate = await commitCandidate(implementationWorkspace, task.id);
  manifest.candidate_sha = candidate.sha;
  manifest.candidate_changed = candidate.changed;
  manifest.objective_checks_passed = checkResults.every((item) => item.exitCode === 0);
  if (!candidate.changed) {
    manifest.status = "failed";
    manifest.failure_reason = "Implementer completed without producing a source change";
    manifest.completed_at = new Date().toISOString();
    await writeJson(path.join(runRoot, "manifest.json"), manifest);
    throw new Error(manifest.failure_reason);
  }
  await writeJson(path.join(runRoot, "manifest.json"), manifest);

  const reviewResults = {};
  for (const reviewer of ["claude", "codex"]) {
    const reviewWorkspace = path.join(workspacesRoot, `review-${reviewer}`);
    const reviewOutput = path.join(resultsRoot, `review-${reviewer}`);
    await addWorktree(repoRoot, reviewWorkspace, candidate.sha);
    await bootstrapWorkspace(
      reviewWorkspace,
      config.workspace.bootstrapCommands,
      path.join(resultsRoot, `bootstrap-review-${reviewer}`),
      timeoutMs,
    );
    reviewResults[reviewer] = await executeProvider({
      provider: reviewer,
      role: "reviewer",
      prompt: buildReviewerPrompt(task, candidate.sha),
      workspace: reviewWorkspace,
      outputDir: reviewOutput,
      config,
      timeoutMs,
    });
    await accountForCost(reviewResults[reviewer]);
  }

  manifest.status = "awaiting_adjudication";
  manifest.completed_at = new Date().toISOString();
  manifest.api_equivalent_cost_usd_total = Number(estimatedPipelineCost.toFixed(8));
  manifest.result_paths = {
    implementation: path.relative(runRoot, implementationOutput),
    claude_review: path.relative(runRoot, path.join(resultsRoot, "review-claude")),
    codex_review: path.relative(runRoot, path.join(resultsRoot, "review-codex")),
  };
  await writeJson(path.join(runRoot, "manifest.json"), manifest);
  await writeFile(path.join(runRoot, "READY_FOR_ADJUDICATION"), "Reviews are complete and have not been shown to either reviewer.\n", "utf8");
  return { runRoot, manifest, reviewResults };
}

export async function reviewExistingCandidate({ repoRoot, task, candidateRef, reviewer = "codex", config, taskFile }) {
  if (!providers[reviewer]) throw new Error("--reviewer must be claude or codex");
  if (task.requiresEvaluationDatabase && !process.env.FISCUS_EVAL_DATABASE_URL) {
    throw new Error("This task requires the isolated evaluation database, but FISCUS_EVAL_DATABASE_URL is missing");
  }

  const baseSha = await resolveRef(repoRoot, task.baseRef);
  const candidateSha = await resolveRef(repoRoot, candidateRef);
  const ancestry = await runFile("git", ["-C", repoRoot, "merge-base", "--is-ancestor", baseSha, candidateSha]);
  if (ancestry.exitCode !== 0) {
    throw new Error(`Candidate ${candidateSha} is not based on ${task.baseRef} (${baseSha})`);
  }

  const runId = `${safeId(task.id)}-existing-${reviewer}-${timestamp()}`;
  const runRoot = path.join(config.runtimeRoot, "reviews", runId);
  const workspace = path.join(runRoot, "workspace");
  const resultsRoot = path.join(runRoot, "results");
  const timeoutMs = config.limits.runTimeoutMinutes * 60_000;
  await ensureDir(resultsRoot);
  await cp(taskFile, path.join(runRoot, "task.json"));

  const manifest = {
    schema_version: 1,
    mode: "existing_candidate_review",
    run_id: runId,
    task_id: task.id,
    reviewer,
    repo_root: repoRoot,
    base_ref: task.baseRef,
    base_sha: baseSha,
    candidate_ref: candidateRef,
    candidate_sha: candidateSha,
    started_at: new Date().toISOString(),
    status: "running",
    execution: await buildExecutionMetadata(repoRoot, config),
  };
  await writeJson(path.join(runRoot, "manifest.json"), manifest);

  await addWorktree(repoRoot, workspace, candidateSha);
  await bootstrapWorkspace(
    workspace,
    config.workspace.bootstrapCommands,
    path.join(resultsRoot, "bootstrap"),
    timeoutMs,
  );
  const checkResults = await runChecks(
    workspace,
    task.requiredChecks,
    path.join(resultsRoot, "objective-checks"),
    timeoutMs,
  );
  manifest.objective_checks_passed = checkResults.every((item) => item.exitCode === 0);
  if (!manifest.objective_checks_passed) {
    manifest.status = "failed_objective_checks";
    manifest.completed_at = new Date().toISOString();
    await writeJson(path.join(runRoot, "manifest.json"), manifest);
    throw new Error("Objective checks failed; frontier review was skipped to avoid unnecessary cost");
  }

  const postCheckState = await captureGitState(workspace);
  manifest.objective_checks_changed_source = postCheckState.status.trim() !== "";
  if (manifest.objective_checks_changed_source) {
    manifest.status = "failed_dirty_after_objective_checks";
    manifest.completed_at = new Date().toISOString();
    await writeJson(path.join(runRoot, "manifest.json"), manifest);
    throw new Error("Objective checks changed tracked or untracked source state; review was skipped");
  }

  const reviewOutput = path.join(resultsRoot, `review-${reviewer}`);
  const reviewResult = await executeProvider({
    provider: reviewer,
    role: "reviewer",
    prompt: buildReviewerPrompt(task, candidateSha),
    workspace,
    outputDir: reviewOutput,
    config,
    timeoutMs,
    allowFallback: true,
  });
  const verdict = extractVerdict(reviewResult.finalText);
  const protocolViolation = reviewResult.record.protocol_source_changed === true;
  const statusByVerdict = {
    PASS: "passed",
    FAIL: "failed",
    INCONCLUSIVE: "inconclusive",
    UNKNOWN: "review_complete_unknown_verdict",
  };
  manifest.verdict = verdict;
  manifest.model_used = reviewResult.record.model_used ?? reviewResult.record.models_used?.[0] ?? null;
  manifest.model_fallback = reviewResult.record.model_fallback ?? null;
  manifest.status = protocolViolation ? "protocol_violation" : statusByVerdict[verdict];
  manifest.protocol_source_changed = protocolViolation;
  manifest.api_equivalent_cost_usd_total = reviewResult.record.api_equivalent_cost_usd;
  manifest.completed_at = new Date().toISOString();
  manifest.result_paths = {
    objective_checks: path.relative(runRoot, path.join(resultsRoot, "objective-checks")),
    review: path.relative(runRoot, reviewOutput),
  };
  await writeJson(path.join(runRoot, "manifest.json"), manifest);
  await writeFile(path.join(runRoot, "REVIEW_COMPLETE"), `${verdict}\n`, "utf8");
  return { runRoot, manifest, reviewResult };
}
