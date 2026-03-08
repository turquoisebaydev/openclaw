import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDiagnosticEvent, resetDiagnosticEventsForTest } from "../infra/diagnostic-events.js";
import {
  onObservabilityEvent,
  resetObservabilityEventsForTest,
  setObservabilityConfigOverrideForTest,
} from "../infra/observability-events.js";
import {
  diagnosticSessionStates,
  getDiagnosticSessionStateCountForTest,
  getDiagnosticSessionState,
  pruneDiagnosticSessionStates,
  resetDiagnosticSessionStateForTest,
} from "./diagnostic-session-state.js";
import {
  logLaneDequeue,
  logLaneEnqueue,
  logRunAttempt,
  logSessionStateChange,
  resetDiagnosticStateForTest,
  resolveStuckSessionWarnMs,
  startDiagnosticHeartbeat,
} from "./diagnostic.js";

describe("diagnostic session state pruning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDiagnosticSessionStateForTest();
  });

  afterEach(() => {
    resetDiagnosticSessionStateForTest();
    vi.useRealTimers();
  });

  it("evicts stale idle session states", () => {
    getDiagnosticSessionState({ sessionId: "stale-1" });
    expect(getDiagnosticSessionStateCountForTest()).toBe(1);

    vi.advanceTimersByTime(31 * 60 * 1000);
    getDiagnosticSessionState({ sessionId: "fresh-1" });

    expect(getDiagnosticSessionStateCountForTest()).toBe(1);
  });

  it("caps tracked session states to a bounded max", () => {
    const now = Date.now();
    for (let i = 0; i < 2001; i += 1) {
      diagnosticSessionStates.set(`session-${i}`, {
        sessionId: `session-${i}`,
        lastActivity: now + i,
        state: "idle",
        queueDepth: 1,
      });
    }
    pruneDiagnosticSessionStates(now + 2002, true);

    expect(getDiagnosticSessionStateCountForTest()).toBe(2000);
  });

  it("reuses keyed session state when later looked up by sessionId", () => {
    const keyed = getDiagnosticSessionState({
      sessionId: "s1",
      sessionKey: "agent:main:discord:channel:c1",
    });
    const bySessionId = getDiagnosticSessionState({ sessionId: "s1" });

    expect(bySessionId).toBe(keyed);
    expect(bySessionId.sessionKey).toBe("agent:main:discord:channel:c1");
    expect(getDiagnosticSessionStateCountForTest()).toBe(1);
  });
});

describe("logger import side effects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not mkdir at import time", async () => {
    vi.useRealTimers();
    vi.resetModules();

    const mkdirSpy = vi.spyOn(fs, "mkdirSync");

    await import("./logger.js");

    expect(mkdirSpy).not.toHaveBeenCalled();
  });
});

describe("stuck session diagnostics threshold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDiagnosticStateForTest();
    resetDiagnosticEventsForTest();
    resetObservabilityEventsForTest();
  });

  afterEach(() => {
    resetDiagnosticEventsForTest();
    resetObservabilityEventsForTest();
    setObservabilityConfigOverrideForTest(undefined);
    resetDiagnosticStateForTest();
    vi.useRealTimers();
  });

  it("uses the configured diagnostics.stuckSessionWarnMs threshold", () => {
    const events: Array<{ type: string }> = [];
    const unsubscribe = onDiagnosticEvent((event) => {
      events.push({ type: event.type });
    });
    try {
      startDiagnosticHeartbeat({
        diagnostics: {
          enabled: true,
          stuckSessionWarnMs: 30_000,
        },
      });
      logSessionStateChange({ sessionId: "s1", sessionKey: "main", state: "processing" });
      vi.advanceTimersByTime(61_000);
    } finally {
      unsubscribe();
    }

    expect(events.filter((event) => event.type === "session.stuck")).toHaveLength(1);
  });

  it("falls back to default threshold when config is absent", () => {
    const events: Array<{ type: string }> = [];
    const unsubscribe = onDiagnosticEvent((event) => {
      events.push({ type: event.type });
    });
    try {
      startDiagnosticHeartbeat();
      logSessionStateChange({ sessionId: "s2", sessionKey: "main", state: "processing" });
      vi.advanceTimersByTime(31_000);
    } finally {
      unsubscribe();
    }

    expect(events.filter((event) => event.type === "session.stuck")).toHaveLength(0);
  });

  it("uses default threshold for invalid values", () => {
    expect(resolveStuckSessionWarnMs({ diagnostics: { stuckSessionWarnMs: -1 } })).toBe(120_000);
    expect(resolveStuckSessionWarnMs({ diagnostics: { stuckSessionWarnMs: 0 } })).toBe(120_000);
    expect(resolveStuckSessionWarnMs()).toBe(120_000);
  });

  it("mirrors session, queue, and run diagnostics into observability events", () => {
    const events: Array<{
      domain: string;
      event: string;
      phase?: string;
      data?: Record<string, unknown>;
    }> = [];
    const unsubscribe = onObservabilityEvent((event) => {
      events.push({
        domain: event.domain,
        event: event.event,
        phase: event.phase,
        data: event.data,
      });
    });
    try {
      logSessionStateChange({ sessionId: "s3", sessionKey: "main", state: "processing" });
      logLaneEnqueue("main", 2);
      logLaneDequeue("main", 150, 1);
      logRunAttempt({ sessionId: "s3", sessionKey: "main", runId: "run-1", attempt: 1 });
    } finally {
      unsubscribe();
    }

    expect(events).toEqual([
      {
        domain: "session",
        event: "state",
        phase: undefined,
        data: { prevState: "idle", state: "processing", reason: undefined, queueDepth: 0 },
      },
      { domain: "queue", event: "lane", phase: "enqueue", data: { lane: "main", queueSize: 2 } },
      {
        domain: "queue",
        event: "lane",
        phase: "dequeue",
        data: { lane: "main", queueSize: 1, waitMs: 150 },
      },
      { domain: "run", event: "attempt", phase: "start", data: { attempt: 1 } },
    ]);
  });

  it("mirrors observability events into structured logs when enabled", () => {
    const logPath = path.join(
      os.tmpdir(),
      `openclaw-observability-${process.pid}-${Date.now()}.log`,
    );
    try {
      setObservabilityConfigOverrideForTest({
        observability: {
          enabled: true,
          logs: { enabled: true, includeEventIds: true, format: "tail", filePath: logPath },
          events: { enabled: true },
        },
      });
      logRunAttempt({ sessionId: "s4", sessionKey: "main", runId: "run-log-1", attempt: 2 });
      const logText = fs.readFileSync(logPath, "utf8");
      expect(logText).toContain("run.attempt.start");
      expect(logText).toContain("id=obs_");
      expect(logText).toContain("run=run-log-1");
      expect(logText).toContain("attempt=2");
    } finally {
      fs.rmSync(logPath, { force: true });
    }
  });
});
