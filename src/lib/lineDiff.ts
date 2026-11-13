export interface LineDiff {
  /** One line per line of the two texts: "-" taken out, "+" put in, " " the same in both. */
  text: string;
  added: number;
  removed: number;
}

/** Past this many cells the comparison isn't worth the wait, and every line counts as changed. */
const MAX_COMPARED_CELLS = 250_000;

const linesOf = (text: string) => (text === "" ? [] : text.split("\n"));

/**
 * Which lines an edit took out and put in. An edit's old and new text share the lines around the
 * change, and those are neither.
 */
export function lineDiff(before: string, after: string): LineDiff {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const out: string[] = a.slice(0, start).map((line) => ` ${line}`);
  let added = 0;
  let removed = 0;
  const take = (line: string) => {
    out.push(`-${line}`);
    removed += 1;
  };
  const put = (line: string) => {
    out.push(`+${line}`);
    added += 1;
  };

  const rows = endA - start;
  const columns = endB - start;
  if (rows * columns > MAX_COMPARED_CELLS) {
    for (let i = start; i < endA; i += 1) take(a[i]);
    for (let j = start; j < endB; j += 1) put(b[j]);
  } else {
    // common[i][j] is how many lines the rest of each text, from i and from j, have in common.
    const common = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = columns - 1; j >= 0; j -= 1) {
        common[i][j] =
          a[start + i] === b[start + j]
            ? common[i + 1][j + 1] + 1
            : Math.max(common[i + 1][j], common[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows || j < columns) {
      if (i < rows && j < columns && a[start + i] === b[start + j]) {
        out.push(` ${a[start + i]}`);
        i += 1;
        j += 1;
      } else if (i < rows && (j === columns || common[i + 1][j] >= common[i][j + 1])) {
        take(a[start + i]);
        i += 1;
      } else {
        put(b[start + j]);
        j += 1;
      }
    }
  }
  for (let i = endA; i < a.length; i += 1) out.push(` ${a[i]}`);
  return { text: out.join("\n"), added, removed };
}

/** The lines a patch takes out and puts in, leaving out its file headers. */
export function patchLineCounts(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}
