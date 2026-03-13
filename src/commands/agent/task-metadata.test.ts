import { describe, expect, it } from "vitest";
import { buildAgentTaskMetadata } from "./task-metadata.js";

describe("buildAgentTaskMetadata", () => {
  it("uses label when provided", () => {
    const task = buildAgentTaskMetadata({
      label: "Investigate dashboard consumer routing",
      prompt: "ignore this prompt",
    });

    expect(task?.summary).toBe("Investigate dashboard consumer routing");
  });

  it("prefers the last useful line of a multiline prompt", () => {
    const task = buildAgentTaskMetadata({
      prompt: [
        "OpenClaw runtime context (internal): recent event data omitted.",
        "",
        "Trace why the dashboard-dev session is not receiving MQTT presence updates.",
        "Reply with exactly: ok.",
      ].join("\n"),
    });

    expect(task?.summary).toBe(
      "Trace why the dashboard-dev session is not receiving MQTT presence updates.",
    );
  });

  it("strips trailing reply-format directives from single-line prompts", () => {
    const task = buildAgentTaskMetadata({
      prompt:
        "Check the dashboard build logs and repair the failing Vite chunk. Reply with exactly: done.",
    });

    expect(task?.summary).toBe("Check the dashboard build logs and repair the failing Vite chunk");
  });

  it("keeps the tail of long prompts so the active work survives truncation", () => {
    const task = buildAgentTaskMetadata({
      prompt:
        "Gather broad context from the repo and old notes before fixing the actual issue where the dashboard MQTT consumer mismaps the live gateway session to the wrong Discord thread in dashboard-dev",
    });

    expect(task?.summary?.startsWith("…")).toBe(true);
    expect(task?.summary).toContain("dashboard MQTT consumer mismaps the live gateway session");
    expect(task?.summary?.endsWith("wrong Discord thread in dashboard-dev")).toBe(true);
  });
});
