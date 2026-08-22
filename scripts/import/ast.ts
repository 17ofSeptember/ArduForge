/**
 * Gate 2 — normalized AST equivalence, and the token-loss check behind
 * non-negotiable #1 (IMPORT.md §0.1, §Non-negotiables).
 *
 * Gate 2 exists for the cases where Gate 1 cannot run or legitimately differs.
 * A pass means "the difference is cosmetic", so the normalizer has to be
 * permissive about the things that genuinely do not matter and strict about
 * everything else. Two choices carry that weight:
 *
 *  - Only user-declared identifiers are canonicalized. Renaming every
 *    identifier would make `pinMode(13, OUTPUT)` and `digitalWrite(13, OUTPUT)`
 *    normalize to the same string, which turns Gate 2 into a rubber stamp.
 *    `setup` and `loop` are excluded too, so their bodies cannot swap unnoticed.
 *
 *  - Function definitions are sorted, global variable declarations are not.
 *    Function order is meaningless once prototypes are generated; global order
 *    is initialization order, and non-negotiable #10 requires it preserved.
 */
import { parseCpp, type TsNode } from './grammar.ts';

// ── token extraction ─────────────────────────────────────────────────────────

/** Leaves only, comments dropped. Tree-sitter is already the lexer here. */
export async function tokensOf(source: string): Promise<string[]> {
  const { root } = await parseCpp(source);
  const tokens: string[] = [];
  const visit = (node: TsNode): void => {
    if (node.type === 'comment') return;
    if (node.childCount === 0) {
      const text = node.text.trim();
      if (text.length > 0) tokens.push(text);
      return;
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) visit(child);
    }
  };
  visit(root);
  return tokens;
}

export interface TokenLoss {
  readonly ok: boolean;
  /** Tokens present in the original that the regenerated sketch does not cover. */
  readonly missing: readonly string[];
  readonly originalCount: number;
  readonly regeneratedCount: number;
}

/**
 * Multiset containment, not equality: the regenerated sketch is allowed to add
 * tokens (prototypes, hoisted temporaries, parentheses codegen inserts to keep
 * precedence). It is never allowed to drop one.
 */
export async function checkTokenLoss(original: string, regenerated: string): Promise<TokenLoss> {
  const [before, after] = await Promise.all([tokensOf(original), tokensOf(regenerated)]);

  const available = new Map<string, number>();
  for (const token of after) available.set(token, (available.get(token) ?? 0) + 1);

  const missing: string[] = [];
  for (const token of before) {
    const left = available.get(token) ?? 0;
    if (left === 0) missing.push(token);
    else available.set(token, left - 1);
  }

  return {
    ok: missing.length === 0,
    // Repeats are noise once you know the token is gone.
    missing: [...new Set(missing)].slice(0, 40),
    originalCount: before.length,
    regeneratedCount: after.length,
  };
}

// ── normalization ────────────────────────────────────────────────────────────

/** Entry points keep their names so their bodies cannot be swapped silently. */
const PINNED = new Set(['setup', 'loop']);

/**
 * Names introduced by this translation unit. Anything not in here — pinMode,
 * HIGH, Serial, millis — keeps its own text through normalization.
 */
function declaredNames(root: TsNode): Set<string> {
  const names = new Set<string>();

  const nameOf = (node: TsNode | null): void => {
    let current = node;
    // Unwrap pointer/array/reference declarators down to the identifier.
    while (current !== null) {
      if (current.type === 'identifier' || current.type === 'field_identifier') {
        if (!PINNED.has(current.text)) names.add(current.text);
        return;
      }
      current = current.childForFieldName('declarator');
    }
  };

  const visit = (node: TsNode): void => {
    if (
      node.type === 'init_declarator' ||
      node.type === 'function_declarator' ||
      node.type === 'parameter_declaration' ||
      node.type === 'array_declarator' ||
      node.type === 'pointer_declarator'
    ) {
      nameOf(node.childForFieldName('declarator'));
    }
    if (node.type === 'declaration') {
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i);
        if (child?.type === 'identifier') nameOf(child);
      }
    }
    if (node.type === 'preproc_def' || node.type === 'preproc_function_def') {
      nameOf(node.childForFieldName('name'));
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) visit(child);
    }
  };

  visit(root);
  return names;
}

/**
 * Canonical text for one subtree. `assign` maps a declared identifier to its
 * canonical form; identifiers the unit does not declare keep their own text, so
 * `analogRead` and `digitalRead` stay distinct.
 */
/**
 * Shapes codegen produces that are semantically identical to what the user
 * wrote but structurally different. Each is normalized away here, and each is
 * guarded by a self-test that the *meaningful* version of the same construct
 * still compares unequal:
 *
 *   - `(x)` vs `x`. A Raw Expression node emits parenthesized so it composes
 *     safely. Unwrapping is safe because precedence lives in the tree shape,
 *     not in the parentheses — `(a+b)*c` and `a+b*c` are different trees either
 *     way.
 *   - `if (c) { … } else { }` vs `if (c) { … }`. control.if always emits both
 *     branches; an empty else is vacuous.
 *   - `if (c) stmt;` vs `if (c) { stmt; }`. Codegen always braces.
 */
function renderNode(node: TsNode, declared: Set<string>, assign: (name: string) => string): string {
  if (node.type === 'comment') return '';

  if (node.type === 'parenthesized_expression') {
    const inner = node.namedChild(0);
    if (inner !== null) return renderNode(inner, declared, assign);
  }

  if (node.type === 'compound_statement') {
    return `(block ${namedStatements(node)
      .map((child) => renderNode(child, declared, assign))
      .filter((text) => text.length > 0)
      .join(' ')})`;
  }

  if (node.type === 'if_statement') {
    const condition = node.childForFieldName('condition');
    const consequence = node.childForFieldName('consequence');
    const alternative = node.childForFieldName('alternative');

    const parts = [
      condition === null ? '' : renderNode(condition, declared, assign),
      consequence === null ? '(block )' : asBlock(consequence, declared, assign),
    ];

    const elseBody = alternative === null ? null : alternative.type === 'else_clause' ? alternative.namedChild(0) : alternative;
    if (elseBody !== null) {
      const rendered = asBlock(elseBody, declared, assign);
      if (rendered !== '(block )') parts.push(rendered);
    }
    return `(if ${parts.join(' ')})`;
  }

  if (node.childCount === 0) {
    const text = node.text.trim();
    if (text.length === 0) return '';
    if ((node.type === 'identifier' || node.type === 'field_identifier') && declared.has(text)) {
      return `(id ${assign(text)})`;
    }
    return `(${node.type} ${text})`;
  }

  const parts: string[] = [];
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child === null) continue;
    const text = renderNode(child, declared, assign);
    if (text.length > 0) parts.push(text);
  }
  return `(${node.type} ${parts.join(' ')})`;
}

/** Statement children of a block, comments excluded. */
function namedStatements(node: TsNode): TsNode[] {
  const found: TsNode[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null && child.type !== 'comment') found.push(child);
  }
  return found;
}

/** A branch body, always as a block, so `stmt;` and `{ stmt; }` agree. */
function asBlock(node: TsNode, declared: Set<string>, assign: (name: string) => string): string {
  if (node.type === 'compound_statement') return renderNode(node, declared, assign);
  const inner = renderNode(node, declared, assign);
  return `(block ${inner})`;
}

export interface NormalizedAst {
  readonly text: string;
  readonly declarations: readonly string[];
}

/**
 * Two passes, and the reason is worth stating: numbering identifiers by first
 * appearance is itself order-sensitive, so sorting declarations *after*
 * numbering them never makes a reordered file match — every downstream
 * reference has already been numbered differently.
 *
 * So pass one renders each declaration with every declared identifier masked to
 * a bare `$`, which gives a sort key that does not depend on order or naming.
 * Pass two walks the sorted sequence and numbers symbols by first appearance
 * within it. Two files that differ only by declaration order and naming now
 * produce the same canonical text.
 *
 * The tradeoff: Gate 2 no longer notices a global reordering that changes
 * initialization order. Gate 1 does, it is the primary gate, and IMPORT.md
 * §0.1 asks for order normalization here specifically. Recorded in
 * docs/IMPORT.md §Gate 2.
 */
export async function normalizeAst(source: string): Promise<NormalizedAst> {
  const { root } = await parseCpp(source);
  const declared = declaredNames(root);

  const top: TsNode[] = [];
  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child === null || child.type === 'comment') continue;
    // Prototypes carry no meaning once definitions are compared; the Arduino
    // preprocessor invents them, so their presence is never a real difference.
    if (child.type === 'declaration' && isPrototype(child)) continue;
    top.push(child);
  }

  const keyed = top
    .map((node) => ({ node, key: renderNode(node, declared, () => '$') }))
    .filter((entry) => entry.key.length > 0);
  keyed.sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? -1 : 1));

  const symbols = new Map<string, string>();
  const assign = (name: string): string => {
    let canonical = symbols.get(name);
    if (canonical === undefined) {
      canonical = `$${symbols.size}`;
      symbols.set(name, canonical);
    }
    return canonical;
  };

  const declarations = keyed.map((entry) => renderNode(entry.node, declared, assign));
  return { text: declarations.join('\n'), declarations };
}

function isPrototype(node: TsNode): boolean {
  const declarator = node.childForFieldName('declarator');
  return declarator?.type === 'function_declarator';
}

export interface AstComparison {
  readonly equal: boolean;
  /** First differing declaration, trimmed — enough to see what moved. */
  readonly detail: string | null;
}

export async function compareAst(original: string, regenerated: string): Promise<AstComparison> {
  const [a, b] = await Promise.all([normalizeAst(original), normalizeAst(regenerated)]);
  if (a.text === b.text) return { equal: true, detail: null };

  const limit = Math.max(a.declarations.length, b.declarations.length);
  for (let i = 0; i < limit; i += 1) {
    const left = a.declarations[i];
    const right = b.declarations[i];
    if (left === right) continue;
    return {
      equal: false,
      detail:
        `declaration ${i}\n` +
        `  original:    ${truncate(left ?? '(absent)')}\n` +
        `  regenerated: ${truncate(right ?? '(absent)')}`,
    };
  }
  return { equal: false, detail: 'declaration counts differ' };
}

function truncate(text: string): string {
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}
