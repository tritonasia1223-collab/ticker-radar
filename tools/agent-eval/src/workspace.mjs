import path from "node:path";
import { rm } from "node:fs/promises";
import { ensureDir, runFile, runShell, writeJson } from "./lib.mjs";

async function mustRun(result) {
  if (result.exitCode !== 0) {
    throw new Error(`${result.command} failed (${result.exitCode})\n${result.stderr || result.stdout}`);
  }
  return result;
}

export async function resolveRef(repoRoot, ref) {
  const result = await mustRun(await runFile("git", ["-C", repoRoot, "rev-parse", "--verify", ref]));
  return result.stdout.trim();
}

export async function addWorktree(repoRoot, destination, ref) {
  await ensureDir(path.dirname(destination));
  await rm(destination, { recursive: true, force: true });
  await mustRun(await runFile("git", ["-C", repoRoot, "worktree", "add", "--detach", destination, ref]));
  return destination;
}

export async function removeWorktree(repoRoot, destination) {
  return runFile("git", ["-C", repoRoot, "worktree", "remove", "--force", destination]);
}

export async function bootstrapWorkspace(workspace, commands, outputDir, timeoutMs) {
  const records = [];
  for (const command of commands) {
    const result = await runShell(command, { cwd: workspace, timeoutMs });
    records.push(result);
    if (result.exitCode !== 0) break;
  }
  await writeJson(path.join(outputDir, "bootstrap.json"), records);
  const failed = records.find((item) => item.exitCode !== 0);
  if (failed) throw new Error(`Workspace bootstrap failed: ${failed.command}`);
  return records;
}

export async function captureGitState(workspace) {
  const [status, diff, staged] = await Promise.all([
    runFile("git", ["status", "--porcelain=v1"], { cwd: workspace }),
    runFile("git", ["diff", "--binary"], { cwd: workspace }),
    runFile("git", ["diff", "--cached", "--binary"], { cwd: workspace }),
  ]);
  return {
    status: status.stdout,
    diff: diff.stdout,
    stagedDiff: staged.stdout,
  };
}

export async function commitCandidate(workspace, taskId) {
  await mustRun(await runFile("git", ["add", "-A"], { cwd: workspace }));
  const staged = await runFile("git", ["diff", "--cached", "--quiet"], { cwd: workspace });
  if (staged.exitCode === 0) {
    const sha = await mustRun(await runFile("git", ["rev-parse", "HEAD"], { cwd: workspace }));
    return { changed: false, sha: sha.stdout.trim() };
  }
  await mustRun(await runFile("git", [
    "-c", "user.name=FISCUS Agent Eval",
    "-c", "user.email=agent-eval@local.invalid",
    "commit", "-m", `eval(${taskId}): candidate`,
  ], { cwd: workspace }));
  const sha = await mustRun(await runFile("git", ["rev-parse", "HEAD"], { cwd: workspace }));
  return { changed: true, sha: sha.stdout.trim() };
}

export async function runChecks(workspace, commands, outputDir, timeoutMs) {
  const records = [];
  for (const command of commands) {
    const result = await runShell(command, { cwd: workspace, timeoutMs });
    records.push(result);
  }
  await writeJson(path.join(outputDir, "checks.json"), records);
  return records;
}
