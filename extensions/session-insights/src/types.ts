export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  tokens: number;
  cost: number;
}

export interface MetricRow {
  name: string;
  sessions: number;
  turns: number;
  calls: number;
  tokens: number;
  cost: number;
}

export interface SessionRecord {
  startedAt: Date;
  cwd?: string;
  userMessages: number;
  assistantTurns: number;
  toolCalls: number;
  usage: UsageTotals;
  models: Map<string, MetricRow>;
  tools: Map<string, number>;
}

export interface Aggregate {
  days: number;
  sessions: number;
  userMessages: number;
  assistantTurns: number;
  toolCalls: number;
  usage: UsageTotals;
  models: MetricRow[];
  projects: MetricRow[];
  tools: MetricRow[];
  dailyTokens: number[];
  dailyTurns: number[];
}

export interface InsightsData {
  generatedAt: Date;
  sessions: SessionRecord[];
}

export type InsightsView = "summary" | "models" | "projects" | "tools";
