import * as fs from "fs";
import * as path from "path";

export interface DLQEntry<T = any> {
  id: string;
  type: string;
  payload: T;
  error: string;
  attempts: number;
  timestamp: string;
}

/**
 * Dead Letter Queue - stores failed requests for later retry.
 * Persists to disk so failures survive restarts.
 */
export class DeadLetterQueue {
  private directory: string;

  constructor(directory: string) {
    this.directory = directory;
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  enqueue(entry: Omit<DLQEntry, "id" | "timestamp">): DLQEntry {
    const fullEntry: DLQEntry = {
      ...entry,
      id: `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    const filePath = path.join(this.directory, `${fullEntry.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullEntry, null, 2));
    return fullEntry;
  }

  readAll(): DLQEntry[] {
    const files = fs.readdirSync(this.directory).filter((f) => f.endsWith(".json"));
    return files.map((file) => {
      const content = fs.readFileSync(path.join(this.directory, file), "utf-8");
      return JSON.parse(content) as DLQEntry;
    });
  }

  remove(id: string): void {
    const filePath = path.join(this.directory, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async retryAll<T>(
    retryFn: (entry: DLQEntry) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T[]> {
    const entries = this.readAll();
    const results: T[] = [];

    for (const entry of entries) {
      try {
        const result = await retryFn(entry);
        results.push(result);
        this.remove(entry.id); // Remove on success
      } catch (error: any) {
        console.error(`[DLQ] Retry failed for ${entry.id}: ${error.message}`);
      }
    }

    return results;
  }
}
