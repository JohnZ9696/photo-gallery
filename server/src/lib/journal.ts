import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

const journalDir = path.join(env.dataDir);
const journalFile = path.join(journalDir, "cleanup-journal.jsonl");

export type JournalEntry = {
  keys: string[];
  photoId?: string;
  createdAt: string;
  reason?: string;
};

async function ensureDir(): Promise<void> {
  await fs.mkdir(journalDir, { recursive: true });
}

export async function appendJournal(entry: JournalEntry): Promise<void> {
  await ensureDir();
  await fs.appendFile(journalFile, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readJournal(): Promise<JournalEntry[]> {
  await ensureDir();
  try {
    const content = await fs.readFile(journalFile, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as JournalEntry;
          if (!Array.isArray(parsed.keys)) return [];
          return [parsed];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function writeJournal(entries: JournalEntry[]): Promise<void> {
  await ensureDir();
  if (entries.length === 0) {
    await fs.rm(journalFile, { force: true });
    return;
  }
  const temp = `${journalFile}.tmp`;
  await fs.writeFile(temp, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  await fs.rename(temp, journalFile);
}
