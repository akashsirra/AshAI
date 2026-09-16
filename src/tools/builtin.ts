import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, isAbsolute } from "node:path";
import type { ToolDefinition } from "../core/types.js";

const execFileAsync = promisify(execFile);

function safePath(workspace: string, requested: string): string {
  const root = resolve(workspace);
  const target = resolve(root, requested || ".");
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Path escapes workspace: ${requested}`);
  return target;
}

export const workspaceInspect: ToolDefinition = {
  name: "workspace.inspect",
  description: "Inspect files and directories in the mission workspace.",
  async execute(input, context) {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const requested = typeof value.path === "string" ? value.path : ".";
    const entries = await readdir(safePath(context.workspace, requested), { withFileTypes: true });
    return entries.slice(0, 200).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
  },
};

export const workspaceReadFile: ToolDefinition = {
  name: "workspace.read_file",
  description: "Read a UTF-8 text file inside the mission workspace.",
  async execute(input, context) {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const path = typeof value.path === "string" && value.path ? value.path : "README.md";
    return await readFile(safePath(context.workspace, path), "utf8");
  },
};

export const workspaceWriteFile: ToolDefinition = {
  name: "workspace.write_file",
  description: "Write a UTF-8 text file inside the mission workspace. Requires mutation approval.",
  requiresApproval: true,
  async execute(input, context) {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (typeof value.path !== "string" || !value.path) throw new Error("workspace.write_file requires path");
    if (typeof value.content !== "string") throw new Error("workspace.write_file requires content");
    const target = safePath(context.workspace, value.path);
    await writeFile(target, value.content, "utf8");
    return { written: true, path: value.path, bytes: Buffer.byteLength(value.content, "utf8") };
  },
};

const SAFE_COMMANDS = new Set(["pwd", "ls", "find", "git", "node", "npm", "npx", "tsc", "cat", "head", "tail", "wc", "grep"]);

export const workspaceExecute: ToolDefinition = {
  name: "workspace.execute",
  description: "Execute an allowlisted local development command in the mission workspace. Mutating commands require approval.",
  async execute(input, context) {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const command = typeof value.command === "string" && value.command.trim() ? value.command.trim() : "git status --short";
    const parts = command.match(/(?:[^\s\"]+|\"[^\"]*\")+/g)?.map((part) => part.replace(/^\"|\"$/g, "")) ?? [];
    const executable = parts[0];
    if (!executable || !SAFE_COMMANDS.has(executable)) throw new Error(`Command not allowlisted: ${executable ?? ""}`);
    const mutating = /(^|\s)(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|git\s+(commit|push|reset|checkout|clean)|npm\s+(install|uninstall|publish))\b/.test(command);
    if (mutating) throw new Error(`Mutating command requires an explicit approval gate: ${command}`);
    try {
      const { stdout, stderr } = await execFileAsync(executable, parts.slice(1), { cwd: context.workspace, timeout: 60_000, maxBuffer: 1024 * 1024, shell: false });
      return { command, exitCode: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      return { command, exitCode: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message ?? String(error) };
    }
  },
};

export const workspaceVerify: ToolDefinition = {
  name: "workspace.verify",
  description: "Run a verification command and report whether it succeeds.",
  async execute(input, context) {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const command = typeof value.command === "string" && value.command.trim() ? value.command.trim() : "npm run typecheck";
    const result = await workspaceExecute.execute({ command }, context) as { exitCode: number };
    return { verified: result.exitCode === 0, command, result };
  },
};
