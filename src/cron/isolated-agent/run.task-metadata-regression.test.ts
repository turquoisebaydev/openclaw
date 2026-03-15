import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFastTestEnv,
  loadRunCronIsolatedAgentTurn,
  makeCronSession,
  makeCronSessionEntry,
  registerAgentRunContextMock,
  resetRunCronIsolatedAgentTurnHarness,
  resolveAgentConfigMock,
  resolveCronSessionMock,
  restoreFastTestEnv,
  runWithModelFallbackMock,
  updateSessionStoreMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

describe("runCronIsolatedAgentTurn — task metadata regression", () => {
  let previousFastTestEnv: string | undefined;

  beforeEach(() => {
    previousFastTestEnv = clearFastTestEnv();
    resetRunCronIsolatedAgentTurnHarness();
    resolveAgentConfigMock.mockReturnValue(undefined);
    updateSessionStoreMock.mockResolvedValue(undefined);
    resolveCronSessionMock.mockReturnValue(
      makeCronSession({
        sessionEntry: makeCronSessionEntry(),
      }),
    );
  });

  afterEach(() => {
    restoreFastTestEnv(previousFastTestEnv);
  });

  it("builds run task metadata from the cron command body before the run starts", async () => {
    const result = await runCronIsolatedAgentTurn({
      cfg: {},
      deps: {} as never,
      sessionKey: "cron:task-metadata",
      message: "check task metadata wiring",
      job: {
        id: "task-metadata-job",
        name: "   ",
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
        sessionTarget: "isolated",
        payload: {
          kind: "agentTurn",
          message: "check task metadata wiring",
          deliver: false,
        },
      } as never,
    });

    expect(result.status).toBe("ok");
    expect(runWithModelFallbackMock).toHaveBeenCalledTimes(1);
    expect(registerAgentRunContextMock).toHaveBeenCalledWith(
      "test-session-id",
      expect.objectContaining({
        task: expect.objectContaining({
          activity: "cron",
          summary: expect.any(String),
        }),
      }),
    );

    const task = registerAgentRunContextMock.mock.calls[0]?.[1]?.task as
      | { summary?: string }
      | undefined;
    expect(task?.summary?.trim()).toBeTruthy();
  });
});
