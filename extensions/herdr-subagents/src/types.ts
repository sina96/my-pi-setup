export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type RunStatus =
  "starting" | "running" | "interrupted" | "completed" | "failed";

export interface ChildResult {
  version: 1;
  status: "completed" | "failed";
  output: string;
  error?: string;
  stopReason?: string;
  sessionFile?: string;
  provider?: string;
  model?: string;
  thinking?: string;
  finishedAt: number;
}

export interface SubagentRun {
  id: string;
  token: string;
  name: string;
  task: string;
  cwd: string;
  paneId: string;
  paneLabel: string;
  resultPath: string;
  exitCodePath: string;
  sessionDir: string;
  provider: string;
  model: string;
  thinking: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  sessionFile?: string;
  consumed: boolean;
  delivered: boolean;
  lastPaneCheckAt?: number;
  paneMissingSince?: number;
}

export interface SubagentDetails {
  id: string;
  name: string;
  status: RunStatus;
  cwd: string;
  paneId: string;
  provider: string;
  model: string;
  thinking: string;
  startedAt: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  sessionFile?: string;
}
