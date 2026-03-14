import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearAgentRunContext, registerAgentRunContext } from "./agent-events.js";
import {
  emitObservabilityEvent,
  onObservabilityEvent,
  resetObservabilityEventsForTest,
  setObservabilityConfigOverrideForTest,
} from "./observability-events.js";

afterEach(() => {
  resetObservabilityEventsForTest();
});

describe("observability tool tail formatting", () => {
  it("prefers exec commandPreview over wrapped raw command", () => {
    const logPath = path.join(
      os.tmpdir(),
      `openclaw-observability-tool-${process.pid}-${Date.now()}.log`,
    );

    try {
      setObservabilityConfigOverrideForTest({
        observability: {
          enabled: true,
          logs: { enabled: true, format: "tail", filePath: logPath },
          events: { enabled: true },
        },
      });

      emitObservabilityEvent({
        domain: "tool",
        event: "call",
        phase: "start",
        runId: "run-tool-1",
        data: {
          toolName: "exec",
          toolCallId: "tool-1",
          argsSummary: {
            kind: "object",
            commandPreview: "check git status → show first 3 lines (in /tmp/project)",
            command:
              'OPENCLAW_PROFILE=mini1 OPENCLAW_STATE_DIR=/tmp/state OPENCLAW_CONFIG_PATH=/tmp/config bash -lc "git status --short | head -n 3"',
          },
        },
      });

      const logText = fs.readFileSync(logPath, "utf8");
      expect(logText).toContain('cmd="check git status → show first 3 lines (in /tmp/project)"');
      expect(logText).not.toContain('cmd="OPENCLAW_PROFILE=mini1');
    } finally {
      fs.rmSync(logPath, { force: true });
    }
  });
});

it("merges task metadata from run context into observability events", () => {
  registerAgentRunContext("run-obs-task", {
    sessionKey: "agent:main:main",
    task: { summary: "repair dashboard routing", cwd: "/tmp/ws" },
  });

  let received;
  const unsubscribe = onObservabilityEvent((event) => {
    if (event.runId === "run-obs-task") {
      received = event;
    }
  });

  try {
    emitObservabilityEvent({
      domain: "llm",
      event: "call",
      phase: "start",
      runId: "run-obs-task",
      data: { provider: "openai", model: "gpt-5.4" },
    });
  } finally {
    unsubscribe();
    clearAgentRunContext("run-obs-task");
  }

  expect(received?.data?.task).toEqual({ summary: "repair dashboard routing", cwd: "/tmp/ws" });
});
