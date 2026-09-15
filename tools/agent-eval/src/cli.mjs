#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { loadJson, normalizeTask, parseArgs, pathExists, runFile, writeJson, expandEnvironment } from "./lib.mjs";
import { runPipeline, runSingle } from "./pipeline.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(toolRoot, "../..");

async function loadConfig() {
  const localPath = path.join(toolRoot, "config.local.json");
  const examplePath = path.join(toolRoot, "config.example.json");
  const config = await loadJson((await pathExists(localPath)) ? localPath : examplePath);
  config.runtimeRoot = path.resolve(expandEnvironment(config.runtimeRoot));
  return config;
}

async function doctor(config) {
  const checks = [];
  const add = (name, ok, details) => checks.push({ name, ok, details });
  add("Node.js", Number(process.versions.node.split(".")[0]) >= 20, process.version);
  const git = await runFile("git", ["--version"]);
  add("Git", git.exitCode === 0, (git.stdout || git.stderr).trim());
  const codex = await runFile("codex", ["--version"]);
  add("Codex CLI", codex.exitCode === 0, (codex.stdout || codex.stderr).trim());
  add("Anthropic API key", Boolean(process.env.ANTHROPIC_API_KEY), process.env.ANTHROPIC_API_KEY ? "available to this process" : "missing");
  add("Evaluation database", Boolean(process.env.FISCUS_EVAL_DATABASE_URL), process.env.FISCUS_EVAL_DATABASE_URL ? "available to this process" : "optional until a persistence task");
  add("Codex isolated home", Boolean(process.env.CODEX_HOME), process.env.CODEX_HOME || "missing");
  if (process.env.CODEX_HOME) {
    const auth = await runFile("codex", ["login", "status"], { env: process.env });
    add("Codex authentication", auth.exitCode === 0, (auth.stdout || auth.stderr).trim());
  }
  const report = { checked_at: new Date().toISOString(), checks };
  console.table(checks);
  await writeJson(path.join(config.runtimeRoot, "doctor.json"), report);
  if (checks.some((item) => !item.ok && !["Evaluation database"].includes(item.name))) process.exitCode = 1;
}

async function findRecordFiles(directory) {
  const found = [];
  if (!(await pathExists(directory))) return found;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findRecordFiles(item));
    else if (entry.name === "record.json") found.push(item);
  }
  return found;
}

async function summarize(config) {
  const files = await findRecordFiles(path.join(config.runtimeRoot, "runs"));
  const records = [];
  for (const file of files) records.push({ file, ...JSON.parse(await readFile(file, "utf8")) });
  console.table(records.map((record) => ({
    provider: record.provider,
    role: record.role,
    model: record.model_requested,
    input: record.input_tokens,
    output: record.output_tokens,
    cost: record.api_equivalent_cost_usd,
    seconds: record.wall_duration_ms == null ? null : Math.round(record.wall_duration_ms / 1000),
    changed: record.protocol_source_changed,
  })));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? "help";
  const config = await loadConfig();
  if (command === "doctor") return doctor(config);
  if (command === "summarize") return summarize(config);
  if (command === "pipeline") {
    if (!args.task || !args.implementer) throw new Error("Usage: pipeline --task <task.json> --implementer claude|codex");
    const taskFile = path.resolve(args.task);
    const task = normalizeTask(await loadJson(taskFile));
    const result = await runPipeline({ repoRoot, task, implementer: args.implementer, config, taskFile });
    console.log(JSON.stringify({ runRoot: result.runRoot, manifest: result.manifest }, null, 2));
    return;
  }
  if (command === "run") {
    if (!args.provider || !args.role || !args.prompt || !args.workspace || !args.output) {
      throw new Error("Usage: run --provider claude|codex --role implementer|reviewer --prompt <file> --workspace <dir> --output <dir>");
    }
    const prompt = await readFile(path.resolve(args.prompt), "utf8");
    await runSingle({
      provider: args.provider,
      role: args.role,
      prompt,
      workspace: path.resolve(args.workspace),
      outputDir: path.resolve(args.output),
      config,
    });
    return;
  }
  console.log(`FISCUS agent evaluation runner\n\nCommands:\n  doctor\n  pipeline --task <task.json> --implementer claude|codex\n  run --provider <name> --role <role> --prompt <file> --workspace <dir> --output <dir>\n  summarize`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
