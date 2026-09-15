import path from "node:path";
import { cp, readFile, writeFile } from "node:fs/promises";
import { buildImplementerPrompt, buildReviewerPrompt } from "./prompts.mjs";
import { runClaude } from "./providers/claude.mjs";
import { runCodex } from "./providers/codex.mjs";
import { addWorktree, bootstrapWorkspace, captureGitState, commitCandidate, resolveRef, runChecks } from "./workspace.mjs";
import { ensureDir, safeId, timestamp, writeJson } from "./lib.mjs";

const providers = {
  claude: runClaude,
  codex: runCodex,
};

async function executeProvider({ provider, role, prompt, workspace, outputDir, config, timeoutMs }) {
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
