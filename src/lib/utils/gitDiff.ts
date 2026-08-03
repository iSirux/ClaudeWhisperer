/**
 * Unified-diff parsing for the PR panel's Diff tab.
 *
 * Turns `git diff` / `gh pr diff` output into per-file entries with hunk-derived
 * line numbers, so the UI can render a collapsible, GitHub-style file list
 * instead of one undifferentiated wall of text.
 */

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'context' | 'meta';

export interface DiffLine {
  text: string;
  kind: DiffLineKind;
  /** Line number in the pre-image, null for added/meta/hunk lines. */
  oldNo: number | null;
  /** Line number in the post-image, null for removed/meta/hunk lines. */
  newNo: number | null;
}

export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export interface DiffFile {
  /** Stable key for `{#each}` — paths can repeat across a rename pair. */
  key: string;
  path: string;
  /** Previous path, only set for renames. */
  oldPath: string | null;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  lines: DiffLine[];
}

/** Git quotes paths containing specials (`"a/we ird\t.ts"`); undo that. */
function unquotePath(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  const inner = value.slice(1, -1);
  return inner.replace(/\\(["\\tnr])/g, (_, c: string) =>
    c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c
  );
}

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` → null. */
function stripPrefix(raw: string): string | null {
  const value = unquotePath(raw);
  if (value === '/dev/null') return null;
  return value.replace(/^[abciow]\//, '');
}

/**
 * Split the `diff --git a/x b/y` header. Paths may contain spaces, so the split
 * point is ambiguous; the `--- `/`+++ ` lines that follow are authoritative and
 * overwrite this, but a mode-only or binary change may not have them.
 */
function parseGitHeader(line: string): { old: string | null; new: string | null } {
  const rest = line.slice('diff --git '.length).trim();
  // Quoted form: "a/one" "b/two"
  const quoted = rest.match(/^("(?:[^"\\]|\\.)*")\s+("(?:[^"\\]|\\.)*")$/);
  if (quoted) return { old: stripPrefix(quoted[1]), new: stripPrefix(quoted[2]) };
  // Unquoted: prefer the split that makes both halves start with a git prefix.
  const parts = rest.split(' ');
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join(' ');
    const right = parts.slice(i).join(' ');
    if (/^[abciow]\//.test(left) && /^[abciow]\//.test(right)) {
      return { old: stripPrefix(left), new: stripPrefix(right) };
    }
  }
  const half = Math.floor(parts.length / 2);
  return {
    old: stripPrefix(parts.slice(0, half).join(' ')),
    new: stripPrefix(parts.slice(half).join(' ')),
  };
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!patch.trim()) return files;

  let current: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;

  const push = () => {
    if (current) files.push(current);
  };

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      push();
      const { old, new: next } = parseGitHeader(line);
      const path = next ?? old ?? '(unknown)';
      current = {
        key: `${files.length}:${path}`,
        path,
        oldPath: null,
        status: 'modified',
        additions: 0,
        deletions: 0,
        binary: false,
        lines: [],
      };
      oldNo = 0;
      newNo = 0;
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldPath = unquotePath(line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.status = 'renamed';
      current.path = unquotePath(line.slice('rename to '.length));
      continue;
    }
    // Headers with nothing to show: index hashes and the ---/+++ path pair
    // (the file card's own header already names the file).
    if (line.startsWith('index ') || line.startsWith('similarity index ')) continue;
    if (line.startsWith('--- ')) {
      const p = stripPrefix(line.slice(4));
      if (p && current.status !== 'renamed') current.oldPath = p;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4));
      if (p) current.path = p;
      continue;
    }
    if (line.startsWith('old mode ') || line.startsWith('new mode ')) {
      current.lines.push({ text: line, kind: 'meta', oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      continue;
    }

    const hunk = line.match(HUNK_RE);
    if (hunk) {
      oldNo = parseInt(hunk[1], 10);
      newNo = parseInt(hunk[3], 10);
      current.lines.push({ text: line, kind: 'hunk', oldNo: null, newNo: null });
      continue;
    }

    if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      current.lines.push({ text: line, kind: 'meta', oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith('+')) {
      current.additions++;
      current.lines.push({ text: line.slice(1), kind: 'add', oldNo: null, newNo: newNo++ });
      continue;
    }
    if (line.startsWith('-')) {
      current.deletions++;
      current.lines.push({ text: line.slice(1), kind: 'del', oldNo: oldNo++, newNo: null });
      continue;
    }
    if (line.startsWith(' ') || line === '') {
      // A trailing empty line at the very end of the patch is just the final
      // newline, not a context line.
      current.lines.push({
        text: line.slice(1),
        kind: 'context',
        oldNo: oldNo++,
        newNo: newNo++,
      });
      continue;
    }
    // Anything else (stray text) is shown verbatim rather than dropped.
    current.lines.push({ text: line, kind: 'meta', oldNo: null, newNo: null });
  }

  push();

  // A patch ending in "\n" adds one phantom context line to the last file.
  const last = files[files.length - 1];
  if (last && patch.endsWith('\n')) {
    const tail = last.lines[last.lines.length - 1];
    if (tail && tail.kind === 'context' && tail.text === '') last.lines.pop();
  }

  return files;
}
