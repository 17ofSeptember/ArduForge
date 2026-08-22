/**
 * Comment attachment (IMPORT.md §Phase 1).
 *
 * Losing every comment on import is silent data loss that none of the fidelity
 * gates catch, because comments do not affect compiled output — Gate 1 passes
 * happily on a sketch stripped of every explanation the user wrote. That makes
 * this the one part of the frontend with no automated safety net downstream, so
 * it is handled explicitly rather than left to fall out of lowering.
 *
 * tree-sitter does surface comments as nodes, but they are siblings of the
 * statements around them and belong to nothing. Attachment decides which
 * statement each one is *about*:
 *
 *   - A comment on the same line as, and after, a statement is trailing.
 *   - Otherwise it leads the next statement, together with any run of comments
 *     directly above it.
 *   - A comment with nothing after it trails whatever came before.
 */
import type { TsNode } from '@/import/grammar';

export interface AttachedComments {
  readonly leading: readonly string[];
  readonly trailing: readonly string[];
}

/**
 * Keyed by the owning node's startIndex, which is stable for a given parse and
 * is what node ids are derived from anyway (§Non-negotiables 4).
 */
export type CommentMap = ReadonlyMap<number, AttachedComments>;

interface Mutable {
  leading: string[];
  trailing: string[];
}

export function attachComments(root: TsNode): CommentMap {
  const map = new Map<number, Mutable>();

  const entry = (node: TsNode): Mutable => {
    let found = map.get(node.startIndex);
    if (found === undefined) {
      found = { leading: [], trailing: [] };
      map.set(node.startIndex, found);
    }
    return found;
  };

  const visitContainer = (container: TsNode): void => {
    const children: TsNode[] = [];
    for (let i = 0; i < container.childCount; i += 1) {
      const child = container.child(i);
      if (child !== null) children.push(child);
    }

    // Comments waiting for the statement they introduce.
    let pending: TsNode[] = [];

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child === undefined) continue;

      if (child.type === 'comment') {
        const previous = children[i - 1];
        const sameLine =
          previous !== undefined &&
          previous.type !== 'comment' &&
          previous.isNamed &&
          previous.endPosition.row === child.startPosition.row;

        if (sameLine && pending.length === 0) entry(previous).trailing.push(child.text);
        else pending.push(child);
        continue;
      }

      if (!child.isNamed) continue;

      if (pending.length > 0) {
        entry(child).leading.push(...pending.map((comment) => comment.text));
        pending = [];
      }
    }

    // Comments at the end of a block belong to the last thing in it, or to the
    // block itself when there is nothing else.
    if (pending.length > 0) {
      const last = [...children].reverse().find((child) => child.isNamed && child.type !== 'comment');
      const owner = last ?? container;
      entry(owner).trailing.push(...pending.map((comment) => comment.text));
    }
  };

  // Any node with a comment among its direct children, rather than an allowlist
  // of containers. An allowlist silently drops whatever it forgot — the trailing
  // comment on an #include line nests *inside* the preproc_include node, not
  // beside it, and was lost until this became general. Each comment is a direct
  // child of exactly one node, so nothing is attached twice.
  const walk = (node: TsNode): void => {
    let hasComment = false;
    for (let i = 0; i < node.childCount; i += 1) {
      if (node.child(i)?.type === 'comment') {
        hasComment = true;
        break;
      }
    }
    if (hasComment) visitContainer(node);
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);

  const frozen = new Map<number, AttachedComments>();
  for (const [key, value] of map) {
    if (value.leading.length === 0 && value.trailing.length === 0) continue;
    frozen.set(key, { leading: value.leading, trailing: value.trailing });
  }
  return frozen;
}


/** Every comment in the file, for the "nothing is lost" accounting. */
export function allComments(root: TsNode): TsNode[] {
  const found: TsNode[] = [];
  const walk = (node: TsNode): void => {
    if (node.type === 'comment') {
      found.push(node);
      return;
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
  return found;
}
