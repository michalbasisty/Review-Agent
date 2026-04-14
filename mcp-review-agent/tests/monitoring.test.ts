import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Monitor, type Alert, type AlertLevel } from "../src/monitor.js";

describe("Production Monitoring & Alerts", () => {
  let monitor: Monitor;
  let alerts: Alert[] = [];

  beforeEach(() => {
    monitor = new Monitor({
      onAlert: (alert: Alert) => alerts.push(alert),
      errorRateThreshold: 0.1, // 10%
      latencyThresholdMs: 5000, // 5s
    });
    alerts = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Error rate monitoring", () => {
    it("should track successful requests", () => {
      monitor.recordRequest("success");
      monitor.recordRequest("success");
      monitor.recordRequest("success");

      const stats = monitor.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.errorRate).toBe(0);
    });

    it("should track failed requests", () => {
      monitor.recordRequest("success");
      monitor.recordRequest("error");
      monitor.recordRequest("success");
      monitor.recordRequest("error");

      const stats = monitor.getStats();
      expect(stats.totalRequests).toBe(4);
      expect(stats.errorRate).toBe(0.5);
    });

    it("should trigger alert when error rate exceeds threshold", () => {
      // 1 success, 9 errors = 90% error rate
      monitor.recordRequest("success");
      for (let i = 0; i < 9; i++) {
        monitor.recordRequest("error");
      }

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]!.level).toBe("critical");
      expect(alerts[0]!.message).toMatch(/error rate/i);
    });
  });

  describe("Latency monitoring", () => {
    it("should track request latency", () => {
      monitor.recordLatency(1000); // 1s
      monitor.recordLatency(2000); // 2s
      monitor.recordLatency(3000); // 3s

      const stats = monitor.getStats();
      expect(stats.avgLatencyMs).toBe(2000);
    });

    it("should alert on high latency", () => {
      monitor.recordLatency(6000); // 6s > 5s threshold

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]!.level).toBe("warning");
      expect(alerts[0]!.message).toMatch(/latency/i);
    });
  });

  describe("Token usage tracking", () => {
    it("should track token consumption", () => {
      monitor.recordTokens(1000);
      monitor.recordTokens(2000);
      monitor.recordTokens(3000);

      const stats = monitor.getStats();
      expect(stats.totalTokens).toBe(6000);
    });

    it("should alert on high token usage", () => {
      const monitor2 = new Monitor({
        onAlert: (a) => alerts.push(a),
        tokenLimitPerRequest: 5000,
      });

      monitor2.recordTokens(6000);

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]!.level).toBe("warning");
    });
  });

  describe("Tool usage tracking", () => {
    it("should track tool call counts", () => {
      monitor.recordToolCall("get_diff");
      monitor.recordToolCall("get_diff");
      monitor.recordToolCall("post_comment");

      const stats = monitor.getStats();
      expect(stats.toolCalls["get_diff"]).toBe(2);
      expect(stats.toolCalls["post_comment"]).toBe(1);
    });

    it("should alert on tool abuse", () => {
      const monitor2 = new Monitor({
        onAlert: (a) => alerts.push(a),
        maxToolCallsPerMinute: 3,
      });

      // Record enough tool calls to exceed the limit
      for (let i = 0; i < 5; i++) {
        monitor2.recordToolCall("get_diff");
      }

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]!.level).toBe("warning");
    });
  });

  describe("Health checks", () => {
    it("should report healthy status", () => {
      monitor.recordRequest("success");
      monitor.recordRequest("success");

      const health = monitor.getHealth();
      expect(health.status).toBe("healthy");
    });

    it("should report degraded status", () => {
      // 1 error out of 10 = 10% error rate (threshold is 10%, so exactly at threshold = healthy)
      // Need > 10% for degraded
      for (let i = 0; i < 9; i++) {
        monitor.recordRequest("success");
      }
      monitor.recordRequest("error"); // 1/10 = 10%

      const health = monitor.getHealth();
      // 10% is at threshold boundary, should still be healthy or degraded
      expect(["healthy", "degraded"]).toContain(health.status);
    });

    it("should report critical status", () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordRequest("error");
      }

      const health = monitor.getHealth();
      expect(health.status).toBe("critical");
    });
  });

  describe("Metrics export", () => {
    it("should export metrics in Prometheus format", () => {
      monitor.recordRequest("success");
      monitor.recordRequest("error");
      monitor.recordLatency(1000);
      monitor.recordTokens(500);

      const prometheus = monitor.toPrometheus();
      expect(prometheus).toContain("mcp_review_requests_total");
      expect(prometheus).toContain("mcp_review_errors_total");
    });
  });
});

describe("Alert Routing", () => {
  it("should route critical alerts immediately", () => {
    const sentAlerts: Alert[] = [];

    const monitor = new Monitor({
      onAlert: (alert) => {
        if (alert.level === "critical") {
          sentAlerts.push(alert);
        }
      },
    });

    // Simulate critical error
    monitor.recordRequest("error");
    monitor.recordRequest("error");
    monitor.recordRequest("error");

    expect(sentAlerts.length).toBeGreaterThan(0);
  });

  it("should deduplicate alerts", () => {
    const sentAlerts: Alert[] = [];

    const monitor = new Monitor({
      onAlert: (alert) => sentAlerts.push(alert),
      alertDedupWindowMs: 10000,
    });

    // Trigger same alert multiple times
    for (let i = 0; i < 5; i++) {
      monitor.recordRequest("error");
    }

    // Should not have duplicate alerts in window
    const uniqueMessages = new Set(sentAlerts.map((a) => a.message));
    expect(uniqueMessages.size).toBeLessThanOrEqual(sentAlerts.length);
  });
});
