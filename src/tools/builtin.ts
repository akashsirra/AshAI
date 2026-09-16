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
    return entries.slice(0, 200).map(entry => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
  },
};

export const workspaceFindFiles: ToolDefinition = {
  name: "workspace.find_files",
  description: "Recursively list workspace files so the agent can establish what actually exists.",
  async execute(input, context) {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const requested = typeof value.path === "string" ? value.path : ".";
    const max = Math.min(1000, Math.max(1, Number(value.max ?? 300)));
    const root = safePath(context.workspace, requested);
    const found: string[] = [];
    const visit = async (dir: string, prefix: string): Promise<void> => {
      if (found.length >= max) return;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (found.length >= max) break;
        if (["node_modules", ".git", ".next", "dist", ".ashai"].includes(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(resolve(dir, entry.name), rel); else found.push(rel);
      }
    };
    await visit(root, "");
    return { path: requested, count: found.length, truncated: found.length >= max, files: found };
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

export const workspaceSearch: ToolDefinition = {
  name: "workspace.search",
  description: "Search tracked workspace text for an exact or regex pattern and return matching file/line evidence.",
  async execute(input, context) {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const pattern = typeof value.pattern === "string" ? value.pattern : "";
    if (!pattern) throw new Error("workspace.search requires pattern");
    const regex = Boolean(value.regex);
    const max = Math.min(200, Math.max(1, Number(value.max ?? 50)));
    const flags = regex ? "i" : "ig";
    const matcher = new RegExp(regex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    const files = (await workspaceFindFiles.execute({ max: 1000 }, context) as { files: string[] }).files;
    const matches: Array<{ path: string; line: number; text: string }> = [];
    for (const path of files) {
      if (matches.length >= max) break;
      try {
        const text = await readFile(safePath(context.workspace, path), "utf8");
        text.split(/\r?\n/).forEach((line, index) => { if (matches.length < max && matcher.test(line)) matches.push({ path, line: index + 1, text: line.slice(0, 500) }); matcher.lastIndex = 0; });
      } catch { /* binary/unreadable files are skipped */ }
    }
    return { pattern, count: matches.length, truncated: matches.length >= max, matches };
  },
};

export const workspaceWriteFile: ToolDefinition = {
  name: "workspace.write_file",
  description: "Write a UTF-8 file inside the mission workspace. Requires mutation approval.",
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
    const parts = command.match(/(?:[^\s\"]+|\"[^\"]*\")+/g)?.map(part => part.replace(/^\"|\"$/g, "")) ?? [];
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
