import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function defaultStateDocument() {
  return {
    version: 1,
    scopes: {},
  };
}

export class MemoryStore {
  constructor(seed) {
    this.document = structuredClone(seed ?? defaultStateDocument());
  }

  async readDocument() {
    return structuredClone(this.document);
  }

  async writeDocument(document) {
    this.document = structuredClone(document);
  }
}

export class JsonFileStore {
  constructor(path) {
    if (!path) throw new Error("JsonFileStore requires a path");
    this.path = path;
  }

  async readDocument() {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultStateDocument();
      if (!parsed.scopes || typeof parsed.scopes !== "object") parsed.scopes = {};
      if (!parsed.version) parsed.version = 1;
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return defaultStateDocument();
      throw error;
    }
  }

  async writeDocument(document) {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temp, this.path);
  }
}

export function defaultStatePath(env = process.env) {
  if (env.AGENT_SUMMARY_STATE) return env.AGENT_SUMMARY_STATE;
  const home = env.HOME || process.cwd();
  return `${home}/.agent-summary-hook/state.json`;
}
