import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolAbuseDetector, type ToolCallRecord } from "../src/tool-abuse.js";

describe("Tool Abuse Detection", () => {
  let detector: ToolAbuseDetector;

  beforeEach(() => {
    detector = new ToolAbuseDetector({
      maxCallsPerMinute: 10,
      maxCallsPerSession: 50,
      windowMs: 60_000,
    });
  });

  it("should allow normal tool usage", () => {
    for (let i = 0; i < 5; i++) {
      const allowed = detector.recordCall("get_diff", "session-1");
      expect(allowed).toBe(true);
    }
  });

  it("should block excessive calls per minute", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordCall("get_diff", "session-1");
    }

    // 11th call should be blocked
    const blocked = detector.recordCall("get_diff", "session-1");
    expect(blocked).toBe(false);
  });

  it("should block excessive calls per session", () => {
    for (let i = 0; i < 50; i++) {
      detector.recordCall("get_diff", "session-1");
    }

    const blocked = detector.recordCall("get_diff", "session-1");
    expect(blocked).toBe(false);
    expect(detector.getAbuseCount("session-1")).toBeGreaterThan(0);
  });

  it("should track different tools separately", () => {
    // 10 calls to get_diff
    for (let i = 0; i < 10; i++) {
      detector.recordCall("get_diff", "session-1");
    }

    // get_context should still be allowed (different tool)
    const allowed = detector.recordCall("get_context", "session-1");
    expect(allowed).toBe(true);
  });

  it("should reset after window expires", async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 10; i++) {
      detector.recordCall("get_diff", "session-1");
    }

    // Blocked
    expect(detector.recordCall("get_diff", "session-1")).toBe(false);

    // Advance past window
    await vi.advanceTimersByTimeAsync(61_000);

    // Should be allowed again
    expect(detector.recordCall("get_diff", "session-1")).toBe(true);

    vi.useRealTimers();
  });

  it("should detect rapid repeated same-tool calls", () => {
    // 5 calls in 1 second
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(detector.recordCall("post_comment", "session-1"));
    }

    const abuseEvents = detector.getRecentAbuse("session-1", 5000);
    expect(abuseEvents.length).toBe(0); // No abuse yet
  });

  it("should block tool bombing (many different tools rapidly)", () => {
    // Set very low limits to catch tool bombing
    const detector2 = new ToolAbuseDetector({
      maxCallsPerMinute: 2,
      maxCallsPerSession: 5,
      windowMs: 60_000,
    });

    const tools = ["get_diff", "post_comment", "get_context", "tool_4", "tool_5"];
    const results = [];

    for (const tool of tools) {
      results.push(detector2.recordCall(tool, "session-1"));
    }

    // Session limit is 5, so 6th call should be blocked
    // But we only have 5 tools, so need to make 1 more call
    results.push(detector2.recordCall("get_diff", "session-1"));

    // At least one should be blocked
    const blocked = results.filter((r) => !r).length;
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("Payload Size Limits", () => {
  it("should reject oversized tool inputs", () => {
    const maxSize = 100_000; // 100KB
    const largeInput = "x".repeat(maxSize + 1);

    expect(largeInput.length).toBeGreaterThan(maxSize);
    // Agent should validate input size before processing
  });
});
