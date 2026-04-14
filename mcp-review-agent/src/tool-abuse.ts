export interface ToolCallRecord {
  tool: string;
  session: string;
  timestamp: number;
}

export interface ToolAbuseConfig {
  maxCallsPerMinute: number;
  maxCallsPerSession: number;
  windowMs: number;
}

export class ToolAbuseDetector {
  private calls: ToolCallRecord[] = [];
  private abuseEvents: { session: string; tool: string; timestamp: number }[] = [];
  private config: ToolAbuseConfig;

  constructor(config: ToolAbuseConfig) {
    this.config = config;
  }

  recordCall(tool: string, session: string): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Clean old calls
    this.calls = this.calls.filter((c) => c.timestamp > windowStart);

    // Count total calls in window for this tool
    const toolCallsInWindow = this.calls.filter(
      (c) => c.tool === tool && c.session === session
    ).length;

    // Count total session calls
    const sessionCalls = this.calls.filter(
      (c) => c.session === session
    ).length;

    // Check limits
    if (toolCallsInWindow >= this.config.maxCallsPerMinute) {
      this.recordAbuse(session, tool);
      return false;
    }

    if (sessionCalls >= this.config.maxCallsPerSession) {
      this.recordAbuse(session, tool);
      return false;
    }

    this.calls.push({ tool, session, timestamp: now });
    return true;
  }

  private recordAbuse(session: string, tool: string) {
    this.abuseEvents.push({
      session,
      tool,
      timestamp: Date.now(),
    });
    console.error(
      `[TOOL ABUSE] Blocked ${tool} for session ${session}`
    );
  }

  getAbuseCount(session: string): number {
    return this.abuseEvents.filter((e) => e.session === session).length;
  }

  getRecentAbuse(session: string, windowMs: number): typeof this.abuseEvents {
    const cutoff = Date.now() - windowMs;
    return this.abuseEvents.filter(
      (e) => e.session === session && e.timestamp > cutoff
    );
  }
}
