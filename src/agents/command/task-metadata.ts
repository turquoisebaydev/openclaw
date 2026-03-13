import type { AgentTaskMetadata } from "../../infra/agent-events.js";

const TASK_TEXT_MAX = 160;
const TASK_URL_MAX = 320;
const RESPONSE_DIRECTIVE_PATTERNS = [
  /^(?:reply|respond|answer|output|return)\s+(?:with\s+)?(?:exactly|only)\b[\s\S]*$/i,
  /(?:[.?!:]\s*|\s+)(?:reply|respond|answer|output|return)\s+(?:with\s+)?(?:exactly|only)\b[\s\S]*$/i,
  /^(?:reply|respond|answer|output|return)\s+(?:in|as)\s+json\b[\s\S]*$/i,
  /(?:[.?!:]\s*|\s+)(?:reply|respond|answer|output|return)\s+(?:in|as)\s+json\b[\s\S]*$/i,
] as const;

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLine(value: string | undefined): string | undefined {
  const trimmed = trimText(value);
  if (!trimmed) {
    return undefined;
  }
  const oneLine = trimmed.replace(/\s+/g, " ").trim();
  return oneLine || undefined;
}

function truncateTail(value: string | undefined, max: number): string | undefined {
  const oneLine = normalizeLine(value);
  if (!oneLine) {
    return undefined;
  }
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `…${oneLine.slice(-Math.max(max - 1, 1))}`;
}

function stripTrailingResponseDirective(value: string): string {
  let current = value.trim();
  for (const pattern of RESPONSE_DIRECTIVE_PATTERNS) {
    current = current.replace(pattern, "").trim();
  }
  return current;
}

function isUsefulSummary(value: string | undefined): value is string {
  return typeof value === "string" && /[\p{L}\p{N}]/u.test(value) && value.length >= 8;
}

function summarizePrompt(prompt: string | undefined): string | undefined {
  const trimmedPrompt = trimText(prompt);
  if (!trimmedPrompt) {
    return undefined;
  }
  const lines = trimmedPrompt
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter((line): line is string => Boolean(line));

  const candidates = (
    lines.length > 1 ? [...lines].toReversed() : [normalizeLine(trimmedPrompt)]
  ).filter((line): line is string => Boolean(line));
  for (const candidate of candidates) {
    const stripped = stripTrailingResponseDirective(candidate);
    if (stripped !== candidate) {
      if (isUsefulSummary(stripped)) {
        return truncateTail(stripped, TASK_TEXT_MAX);
      }
      continue;
    }
    if (isUsefulSummary(candidate)) {
      return truncateTail(candidate, TASK_TEXT_MAX);
    }
  }

  const strippedPrompt = stripTrailingResponseDirective(
    normalizeLine(trimmedPrompt) ?? trimmedPrompt,
  );
  if (isUsefulSummary(strippedPrompt)) {
    return truncateTail(strippedPrompt, TASK_TEXT_MAX);
  }
  return truncateTail(trimmedPrompt, TASK_TEXT_MAX);
}

export function buildAgentTaskMetadata(params: {
  prompt?: string;
  label?: string;
  activity?: string;
  cwd?: string;
  cmdline?: string;
  url?: string;
}): AgentTaskMetadata | undefined {
  const summary = truncateTail(params.label, TASK_TEXT_MAX) ?? summarizePrompt(params.prompt);
  const activity = truncateTail(params.activity, TASK_TEXT_MAX);
  const cwd = truncateTail(params.cwd, TASK_TEXT_MAX);
  const cmdline = truncateTail(params.cmdline, TASK_TEXT_MAX);
  const url = truncateTail(params.url, TASK_URL_MAX);
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
