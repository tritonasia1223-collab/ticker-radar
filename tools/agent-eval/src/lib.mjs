import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile, access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function expandEnvironment(value) {
  if (typeof value !== "string") return value;
  return value.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function appendJsonLine(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function runFile(command, args, options = {}) {
  const startedAt = Date.now();
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    });
    return {
      command: [command, ...args].join(" "),
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      command: [command, ...args].join(" "),
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? String(error),
      durationMs: Date.now() - startedAt,
      timedOut: error.killed === true,
    };
  }
}

export async function runShell(command, options = {}) {
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const args = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
    : ["-lc", command];
  return runFile(shell, args, options);
}

export function cleanEnvironment(extra = {}, remove = []) {
  const entries = Object.entries(process.env).filter(([, value]) => typeof value === "string");
  const environment = { ...Object.fromEntries(entries), ...extra };
  for (const name of remove) delete environment[name];
  return environment;
}

export async function streamProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export function calculateApiEquivalent(usage, pricing) {
  if (!usage || !pricing) return null;
  const cached = usage.cached_input_tokens ?? 0;
  const cacheWrite = usage.cache_write_input_tokens ?? 0;
  const regularInput = Math.max(0, (usage.input_tokens ?? 0) - cached - cacheWrite);
  const cost =
    regularInput * (pricing.input ?? 0) +
    cached * (pricing.cachedInput ?? 0) +
    cacheWrite * (pricing.cacheWrite ?? pricing.input ?? 0) +
    (usage.output_tokens ?? 0) * (pricing.output ?? 0);
  return Number((cost / 1_000_000).toFixed(8));
}

export function normalizeTask(task) {
  const required = ["id", "title", "baseRef", "requirement", "acceptanceCriteria", "requiredChecks"];
  for (const key of required) {
    if (task[key] === undefined || task[key] === null) throw new Error(`Task is missing ${key}`);
  }
  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    throw new Error("Task acceptanceCriteria must contain at least one item");
  }
  if (!Array.isArray(task.requiredChecks)) throw new Error("Task requiredChecks must be an array");
  return task;
}

export function extractVerdict(text) {
  const match = String(text ?? "").match(/^\s*VERDICT\s*:\s*(PASS|FAIL|INCONCLUSIVE)\b/im);
  return match ? match[1].toUpperCase() : "UNKNOWN";
}
