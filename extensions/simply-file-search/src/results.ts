import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";

export type SearchMatch = {
  kind: "match" | "context";
  path: string;
  line: number;
  column: number;
  text: string;
};

export const SearchOutputSchema = Type.Object({
  engine: Type.String(),
  files: Type.Array(Type.String()),
  matches: Type.Array(Type.Object({
    kind: Type.Union([Type.Literal("match"), Type.Literal("context")]),
    path: Type.String(),
    line: Type.Integer(),
    column: Type.Integer(),
    text: Type.String(),
  })),
  resultCount: Type.Integer(),
  truncated: Type.Boolean(),
  limitReached: Type.Boolean(),
  fullOutputPath: Type.Optional(Type.String()),
});

function decode(value: { text?: string; bytes?: string }): string {
  if (typeof value.text === "string") return value.text;
  if (typeof value.bytes === "string") return Buffer.from(value.bytes, "base64").toString("utf8");
  throw new Error("Malformed ripgrep JSON text field");
}

/** JSON avoids ambiguous file:line parsing (colons, digits, and Unicode paths). */
export function parseRipgrep(output: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type !== "match" && event.type !== "context") continue;
    const data = event.data;
    matches.push({
      kind: event.type,
      path: decode(data.path),
      line: data.line_number,
      // ripgrep reports byte offsets, not Unicode display columns.
      column: event.type === "match" ? (data.submatches?.[0]?.start ?? 0) + 1 : 0,
      text: decode(data.lines).replace(/\r?\n$/, ""),
    });
  }
  return matches;
}

function display(record: string | SearchMatch): string {
  if (typeof record === "string") return record;
  return record.kind === "match"
    ? `${record.path}:${record.line}:${record.column}:${record.text}`
    : `${record.path}-${record.line}-${record.text}`;
}

/** Bound both JSON for scripts and text for direct calls; never hide cap loss. */
export async function formatSearchResult(
  records: string[] | SearchMatch[],
  engine: string,
  limit: number,
  candidateLimitReached = false,
) {
  const selected = records.slice(0, limit);
  const limitReached = records.length > limit || candidateLimitReached;
  const retained: Array<string | SearchMatch> = [];
  let textBytes = 0;
  let jsonBytes = 0;
  let textLines = 0;
  for (const record of selected) {
    const rendered = display(record);
    const bytes = Buffer.byteLength(rendered, "utf8") + 1;
    const dataBytes = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    const lines = rendered.split("\n").length;
    // Leave room for result metadata and a truncation notice.
    if (textBytes + bytes > DEFAULT_MAX_BYTES - 2048 || jsonBytes + dataBytes > DEFAULT_MAX_BYTES - 2048 || textLines + lines > DEFAULT_MAX_LINES) break;
    retained.push(record);
    textBytes += bytes;
    jsonBytes += dataBytes;
    textLines += lines;
  }

  const byteTruncated = retained.length < selected.length;
  const structuredContent = {
    engine,
    files: retained.filter((record): record is string => typeof record === "string"),
    matches: retained.filter((record): record is SearchMatch => typeof record !== "string"),
    resultCount: retained.length,
    truncated: limitReached || byteTruncated,
    limitReached,
    ...(byteTruncated ? { fullOutputPath: "" } : {}),
  };
  let text = retained.map(display).join("\n");
  if (byteTruncated) {
    const directory = await mkdtemp(join(tmpdir(), "pi-simply-search-"));
    structuredContent.fullOutputPath = join(directory, "output.txt");
    await writeFile(structuredContent.fullOutputPath, selected.map(display).join("\n"), "utf8");
    text += `\n\n[Byte limit reached. Full output within the requested result limit: ${structuredContent.fullOutputPath}]`;
  }
  if (limitReached) text += "\n\n[Result/candidate limit reached; narrow the search or increase limit.]";
  if (!selected.length) text = engine === "rg" ? "No matches found" : "No files found";
  return {
    content: [{ type: "text" as const, text }],
    details: { engine, resultCount: retained.length, truncated: structuredContent.truncated, fullOutputPath: structuredContent.fullOutputPath },
    structuredContent,
  };
}
