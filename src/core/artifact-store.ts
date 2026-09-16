import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface Artifact { id: string; missionId: string; name: string; path: string; size: number; createdAt: string; }

export class ArtifactStore {
  constructor(private readonly root = process.env.ASHAI_ARTIFACT_DIR ?? ".ashai/artifacts") {}
  async save(missionId: string, name: string, content: string): Promise<Artifact> {
    const id = randomUUID();
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const dir = resolve(this.root, missionId);
    const path = resolve(dir, `${id}-${safeName}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path, content, "utf8");
    return { id, missionId, name: safeName, path, size: Buffer.byteLength(content), createdAt: new Date().toISOString() };
  }
}
