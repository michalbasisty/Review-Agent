export type AlertLevel = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  level: AlertLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface MonitorConfig {
  onAlert: (alert: Alert) => void;
  errorRateThreshold?: number;
  latencyThresholdMs?: number;
  tokenLimitPerRequest?: number;
  maxToolCallsPerMinute?: number;
  alertDedupWindowMs?: number;
}

export interface RequestStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  avgLatencyMs: number;
  totalTokens: number;
  toolCalls: Record<string, number>;
}

export class Monitor {
  private config: MonitorConfig;
  private requests: { status: "success" | "error"; timestamp: number }[] = [];
  private latencies: number[] = [];
  private tokens: number[] = [];
  private toolCallCounts: Record<string, number> = {};
  private recentAlerts: { message: string; timestamp: number }[] = [];

  constructor(config: MonitorConfig) {
    this.config = {
      errorRateThreshold: 0.1,
      latencyThresholdMs: 5000,
      tokenLimitPerRequest: 100_000,
      maxToolCallsPerMinute: 60,
      alertDedupWindowMs: 30_000,
      ...config,
    };
  }

  recordRequest(status: "success" | "error"): void {
    this.requests.push({ status, timestamp: Date.now() });
    this.checkErrorRate();
  }

  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (ms > (this.config.latencyThresholdMs ?? 5000)) {
      this.sendAlert("warning", `High latency detected: ${ms}ms`);
    }
  }

  recordTokens(count: number): void {
    this.tokens.push(count);
    if (count > (this.config.tokenLimitPerRequest ?? 100_000)) {
      this.sendAlert("warning", `High token usage: ${count} tokens`);
    }
  }

  recordToolCall(tool: string): void {
    this.toolCallCounts[tool] = (this.toolCallCounts[tool] || 0) + 1;

    const now = Date.now();
    const windowStart = now - 60_000;
    const toolCallsInWindow = this.toolCallCounts[tool] || 0;

    const maxCalls = this.config.maxToolCallsPerMinute ?? 60;
    if (toolCallsInWindow > maxCalls) {
      this.sendAlert("warning", `Tool rate limit exceeded: ${tool}`);
    }
  }

  getStats(): RequestStats {
    const total = this.requests.length;
    const errors = this.requests.filter((r) => r.status === "error").length;
    const successes = total - errors;
    const avgLatency =
      this.latencies.length > 0
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
        : 0;

    return {
      totalRequests: total,
      successfulRequests: successes,
      failedRequests: errors,
      errorRate: total > 0 ? errors / total : 0,
      avgLatencyMs: Math.round(avgLatency),
      totalTokens: this.tokens.reduce((a, b) => a + b, 0),
      toolCalls: { ...this.toolCallCounts },
    };
  }

  getHealth(): {
    status: "healthy" | "degraded" | "critical";
    stats: RequestStats;
  } {
    const stats = this.getStats();

    if (stats.errorRate > 0.5) {
      return { status: "critical", stats };
    }
    if (stats.errorRate > (this.config.errorRateThreshold ?? 0.1)) {
      return { status: "degraded", stats };
    }
    return { status: "healthy", stats };
  }

  toPrometheus(): string {
    const stats = this.getStats();
    return [
      `# HELP mcp_review_requests_total Total requests`,
      `# TYPE mcp_review_requests_total counter`,
      `mcp_review_requests_total ${stats.totalRequests}`,
      `# HELP mcp_review_errors_total Total errors`,
      `# TYPE mcp_review_errors_total counter`,
      `mcp_review_errors_total ${stats.failedRequests}`,
      `# HELP mcp_review_error_rate Error rate`,
      `# TYPE mcp_review_error_rate gauge`,
      `mcp_review_error_rate ${stats.errorRate.toFixed(4)}`,
      `# HELP mcp_review_avg_latency_ms Average latency`,
      `# TYPE mcp_review_avg_latency_ms gauge`,
      `mcp_review_avg_latency_ms ${stats.avgLatencyMs}`,
      `# HELP mcp_review_tokens_total Total tokens used`,
      `# TYPE mcp_review_tokens_total counter`,
      `mcp_review_tokens_total ${stats.totalTokens}`,
    ].join("\n");
  }

  private checkErrorRate(): void {
    const stats = this.getStats();
    const threshold = this.config.errorRateThreshold ?? 0.1;

    if (stats.errorRate > threshold) {
      this.sendAlert("critical", `Error rate exceeded: ${(stats.errorRate * 100).toFixed(1)}% > ${(threshold * 100).toFixed(1)}%`);
    }
  }

  private sendAlert(level: AlertLevel, message: string): void {
    // Deduplication
    const now = Date.now();
    const dedupWindow = this.config.alertDedupWindowMs ?? 30_000;
    const isDuplicate = this.recentAlerts.some(
      (a) =>
        a.message === message &&
        now - a.timestamp < dedupWindow
    );

    if (isDuplicate) return;

    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    this.recentAlerts.push({ message, timestamp: now });
    this.config.onAlert(alert);
  }
}
