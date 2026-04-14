import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithBackoff } from "../src/retry.js";

describe("Timeout Handling Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should succeed on first try", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = retryWithBackoff(fn, 3, 100);
    await vi.runAllTimersAsync();
    expect(await result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and eventually succeed", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("success");

    const result = retryWithBackoff(fn, 3, 100);
    await vi.runAllTimersAsync();
    expect(await result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should fail after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = retryWithBackoff(fn, 3, 100);
    await vi.runAllTimersAsync();
    await expect(result).rejects.toThrow("timeout");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should use exponential backoff delays", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const promise = retryWithBackoff(fn, 3, 1000);

    // First retry at 1s
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry at 2s
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    // Third retry at 4s
    await vi.advanceTimersByTimeAsync(4000);
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("fail");
  });

  it("should handle API timeout errors gracefully", async () => {
    const timeoutError = new Error("ETIMEDOUT");
    timeoutError.name = "TimeoutError";

    const fn = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValue("recovered");

    const result = retryWithBackoff(fn, 2, 100);
    await vi.runAllTimersAsync();
    expect(await result).toBe("recovered");
  });

  it("should handle rate limit (429) errors", async () => {
    const rateLimitError = new Error("Rate limit exceeded");
    (rateLimitError as any).status = 429;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValue("ok");

    const result = retryWithBackoff(fn, 3, 100);
    await vi.runAllTimersAsync();
    expect(await result).toBe("ok");
  });
});

describe("LLM Fallback Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should handle LLM timeout gracefully", async () => {
    // Test the retry mechanism with a simulated timeout
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValue("recovered");

    const result = retryWithBackoff(fn, 3, 100);
    await vi.runAllTimersAsync();
    expect(await result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
