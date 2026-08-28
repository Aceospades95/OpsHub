/**
 * Pure helpers for mirroring Google Tasks' own structure — subtask
 * nesting and manual "My order" — from synced rows (list-fidelity
 * phase two). No I/O and no server-only imports: the sync engine
 * stamps `googleParentId` / `googlePosition` on pull, and the /my
 * "By list" view (a client component) rebuilds Google's tree from
 * whatever rows it was handed.
 */

/**
 * Split a sourceId ("<tasklistId>:<taskId>") back into list + task.
 * Legacy bare ids have no list. Shared by the sync push path and the
 * tree builder's parent matching (googleParentId stores the BARE id).
 */
export function parseSourceId(sourceId: string): { tasklistId: string | null; taskId: string } {
  const i = sourceId.indexOf(":");
  if (i === -1) return { tasklistId: null, taskId: sourceId };
  return { tasklistId: sourceId.slice(0, i), taskId: sourceId.slice(i + 1) };
}

/**
 * What the tree builder needs from a row — the Prisma Task row and the
 * /my UI row shape both satisfy it. Rows must all belong to ONE Google
 * list (Google task ids are only unique per list).
 */
export interface GoogleTreeRow {
  /** "<tasklistId>:<taskId>" composite key (legacy rows: bare task id). */
  sourceId: string | null;
  /** Bare Google id of the PARENT task when this is a subtask. */
  googleParentId: string | null;
  /** Google's lexicographic sort key among siblings ("My order"). */
  googlePosition: string | null;
}

export type GoogleTaskTreeNode<T> = T & { children: T[] };

/**
 * Lexicographic `position` compare (plain code-unit order — Google's
 * positions are zero-padded ASCII strings), nulls LAST. Ties return 0
 * so the stable sort keeps unstamped rows (pulled before the field
 * existed) in their original order.
 */
function comparePosition(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rebuild Google's own structure for one list: top-level tasks in
 * "My order" (`position`), each carrying its subtasks sorted the same
 * way. A child names its parent by BARE Google task id, matched against
 * the bare id inside each row's sourceId.
 *
 * ORPHANS — a googleParentId with no matching row (parent completed,
 * deleted, or simply not in `rows`) — surface as top-level tasks,
 * never dropped. Google only allows one level of nesting, but if a
 * deeper chain ever appears the descendants flatten under their
 * top-level ancestor, and a cycle (impossible from Google; guarded
 * anyway) breaks its members out to top level.
 */
export function buildGoogleTaskTree<T extends GoogleTreeRow>(rows: T[]): GoogleTaskTreeNode<T>[] {
  // Index rows by bare Google task id for parent matching.
  const byTaskId = new Map<string, T>();
  for (const row of rows) {
    if (!row.sourceId) continue;
    const bare = parseSourceId(row.sourceId).taskId;
    if (!byTaskId.has(bare)) byTaskId.set(bare, row);
  }

  const topLevel: T[] = [];
  const childrenOf = new Map<T, T[]>();

  for (const row of rows) {
    // Walk up the parent chain to the row's top-level ancestor. Real
    // Google data makes this a single hop (or none); the walk exists
    // so bad data degrades to "everything still renders".
    const visited = new Set<T>([row]);
    let cursor = row;
    let cycle = false;
    let parent = cursor.googleParentId !== null ? byTaskId.get(cursor.googleParentId) : undefined;
    while (parent) {
      if (visited.has(parent)) {
        cycle = true;
        break;
      }
      visited.add(parent);
      cursor = parent;
      parent = cursor.googleParentId !== null ? byTaskId.get(cursor.googleParentId) : undefined;
    }

    if (cycle || cursor === row) {
      topLevel.push(row);
    } else {
      const bucket = childrenOf.get(cursor);
      if (bucket) bucket.push(row);
      else childrenOf.set(cursor, [row]);
    }
  }

  // Array.prototype.sort is stable, so equal keys (both null) keep
  // their original relative order — see comparePosition.
  topLevel.sort((a, b) => comparePosition(a.googlePosition, b.googlePosition));
  return topLevel.map((row) => ({
    ...row,
    children: (childrenOf.get(row) ?? []).sort((a, b) =>
      comparePosition(a.googlePosition, b.googlePosition)
    ),
  }));
}
