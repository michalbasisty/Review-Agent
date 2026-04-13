import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeadLetterQueue, DLQEntry } from "../src/dlq";
import * as fs from "fs";
import * as path from "path";

describe("Dead Letter Queue (DLQ)", () => {
  const testDir = path.join(__dirname, "test-dlq");
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    // Clean test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    dlq = new DeadLetterQueue(testDir);
  });

  it("should enqueue failed messages", () => {
    const entry = dlq.enqueue({
      type: "review",
      payload: { pr_url: "https://github.com/test/pull/1" },
      error: "API timeout",
      attempts: 3,
    });

    expect(entry).toBeDefined();
    expect(entry.type).toBe("review");
    expect(entry.error).toBe("API timeout");
    expect(entry.attempts).toBe(3);
  });

  it("should persist entries to disk", () => {
    dlq.enqueue({
      type: "review",
      payload: { pr_url: "https://github.com/test/pull/1" },
      error: "Rate limited",
      attempts: 3,
    });

    const files = fs.readdirSync(testDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.json$/);

    const content = fs.readFileSync(path.join(testDir, files[0]!), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.type).toBe("review");
    expect(parsed.error).toBe("Rate limited");
  });

  it("should read all pending entries", () => {
    dlq.enqueue({
      type: "review",
      payload: { pr_url: "https://github.com/test/pull/1" },
      error: "Error 1",
      attempts: 3,
    });

    dlq.enqueue({
      type: "review",
      payload: { pr_url: "https://github.com/test/pull/2" },
      error: "Error 2",
      attempts: 3,
    });

    const entries = dlq.readAll();
    expect(entries.length).toBe(2);
    // Order may vary due to filesystem, so check both exist
    const errors = entries.map((e) => e.error);
    expect(errors).toContain("Error 1");
    expect(errors).toContain("Error 2");
  });

  it("should remove processed entries", () => {
    const entry = dlq.enqueue({
      type: "review",
      payload: { pr_url: "https://github.com/test/pull/1" },
      error: "Test error",
      attempts: 3,
    });

    dlq.remove(entry.id);
    const entries = dlq.readAll();
    expect(entries.length).toBe(0);

    const files = fs.readdirSync(testDir);
    expect(files.length).toBe(0);
  });

  it("should handle large payloads", () => {
    const largePayload = {
      type: "review",
      payload: {
        pr_url: "https://github.com/test/pull/1",
        diff: "x".repeat(10000), // 10KB diff
      },
      error: "Memory limit exceeded",
      attempts: 3,
    };

    const entry = dlq.enqueue(largePayload);
    expect(entry.payload.diff.length).toBe(10000);
  });

  it("should retry entries with backoff", async () => {
    vi.useFakeTimers();

    const retryFn = vi.fn().mockResolvedValue("success");

    dlq.enqueue({
      type: "review",
      payload: { pr_url: "https://github.com/test/pull/1" },
      error: "Temporary failure",
      attempts: 3,
    });

    const result = dlq.retryAll(retryFn);
    await vi.runAllTimersAsync();

    expect(await result).toHaveLength(1);
    expect(retryFn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
