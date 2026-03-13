import type { AgentTaskMetadata } from "../../infra/agent-events.js";

const TASK_TEXT_MAX = 160;
const TASK_URL_MAX = 320;

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function truncate(value: string | undefined, max: number): string | undefined {
  const trimmed = trimText(value);
  if (!trimmed) {
    return undefined;
  }
  const oneLine = trimmed.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, Math.max(max - 1, 1))}…`;
}

export function buildAgentTaskMetadata(params: {
  prompt?: string;
  label?: string;
  activity?: string;
  cwd?: string;
  cmdline?: string;
  url?: string;
}): AgentTaskMetadata | undefined {
  const summary = truncate(params.label ?? params.prompt, TASK_TEXT_MAX);
  const activity = truncate(params.activity, TASK_TEXT_MAX);
  const cwd = truncate(params.cwd, TASK_TEXT_MAX);
  const cmdline = truncate(params.cmdline, TASK_TEXT_MAX);
  const url = truncate(params.url, TASK_URL_MAX);
  if (!summary && !activity && !cwd && !cmdline && !url) {
    return undefined;
  }
  return {
    ...(summary ? { summary } : {}),
    ...(activity ? { activity } : {}),
    ...(cwd ? { cwd } : {}),
    ...(cmdline ? { cmdline } : {}),
    ...(url ? { url } : {}),
  };
}
