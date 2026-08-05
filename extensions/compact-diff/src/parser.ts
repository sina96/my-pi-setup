export type DiffLineKind = "meta" | "hunk" | "context" | "add" | "remove";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  filePath?: string;
  oldLine?: number;
  newLine?: number;
  hunkIndex?: number;
};

export type DiffFile = {
  path: string;
  start: number;
  end: number;
  additions: number;
  deletions: number;
};

export type DiffDocument = {
  text: string;
  lines: DiffLine[];
  files: DiffFile[];
  hunks: number[];
};

function headerPath(value: string, prefix: "a/" | "b/"): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return undefined;
  const withoutTimestamp = trimmed.split("\t", 1)[0] ?? trimmed;
  const unquoted =
    withoutTimestamp.startsWith('"') && withoutTimestamp.endsWith('"')
      ? withoutTimestamp.slice(1, -1)
      : withoutTimestamp;
  return unquoted.startsWith(prefix) ? unquoted.slice(2) : unquoted;
}

export function parseDiff(text: string): DiffDocument {
  const lines: DiffLine[] = [];
  const hunks: number[] = [];
  let currentFile: string | undefined;
  let pendingOldFile: string | undefined;
  let oldLine = 0;
  let newLine = 0;
  let hunkIndex: number | undefined;

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const match = raw.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentFile = match?.[2] ?? currentFile;
      pendingOldFile = match?.[1];
      hunkIndex = undefined;
      lines.push({ kind: "meta", text: raw, filePath: currentFile });
      continue;
    }
    if (raw.startsWith("--- ")) {
      pendingOldFile = headerPath(raw.slice(4), "a/");
      lines.push({
        kind: "meta",
        text: raw,
        filePath: currentFile ?? pendingOldFile,
      });
      continue;
    }
    if (raw.startsWith("+++ ")) {
      currentFile = headerPath(raw.slice(4), "b/") ?? pendingOldFile;
      lines.push({ kind: "meta", text: raw, filePath: currentFile });
      continue;
    }
    if (raw.startsWith("@@")) {
      const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      hunkIndex = lines.length;
      hunks.push(hunkIndex);
      lines.push({ kind: "hunk", text: raw, filePath: currentFile, hunkIndex });
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push({
        kind: "add",
        text: raw,
        filePath: currentFile,
        newLine,
        hunkIndex,
      });
      newLine++;
      continue;
    }
    if (raw.startsWith("-") && !raw.startsWith("---")) {
      lines.push({
        kind: "remove",
        text: raw,
        filePath: currentFile,
        oldLine,
        hunkIndex,
      });
      oldLine++;
      continue;
    }
    if (raw.startsWith(" ")) {
      lines.push({
        kind: "context",
        text: raw,
        filePath: currentFile,
        oldLine,
        newLine,
        hunkIndex,
      });
      oldLine++;
      newLine++;
      continue;
    }
    lines.push({ kind: "meta", text: raw, filePath: currentFile, hunkIndex });
  }

  const fileStarts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.text.startsWith("diff --git "));
  const files: DiffFile[] = fileStarts.map(({ line, index }, fileIndex) => {
    const end = (fileStarts[fileIndex + 1]?.index ?? lines.length) - 1;
    const section = lines.slice(index, end + 1);
    const path =
      section.find((candidate) => candidate.text.startsWith("+++ "))
        ?.filePath ??
      line.filePath ??
      "unknown";
    return {
      path,
      start: index,
      end,
      additions: section.filter((candidate) => candidate.kind === "add").length,
      deletions: section.filter((candidate) => candidate.kind === "remove")
        .length,
    };
  });

  return { text, lines, files, hunks };
}

export function hunkText(document: DiffDocument, selected: number): string {
  const line = document.lines[selected];
  if (line?.hunkIndex == null) return line?.text ?? "";
  let end = line.hunkIndex + 1;
  while (
    end < document.lines.length &&
    document.lines[end]?.hunkIndex === line.hunkIndex
  )
    end++;
  return document.lines
    .slice(line.hunkIndex, end)
    .map((item) => item.text)
    .join("\n");
}
