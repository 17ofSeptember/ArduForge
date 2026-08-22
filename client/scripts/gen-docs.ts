/**
 * Generates docs/node-reference.md from the registry.
 *
 * Written rather than hand-maintained: a hand-written node reference drifts
 * from the code the first time anyone adds a node, and a wrong reference is
 * worse than none.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { allNodeDefs, inputPorts, outputPorts, execOuts } from '../src/nodes/registry';
import { CATEGORY } from '../src/nodes/types';

const byCategory = new Map();
for (const def of allNodeDefs) {
  if (!byCategory.has(def.category)) byCategory.set(def.category, []);
  byCategory.get(def.category).push(def);
}

const lines = [
  '# Node reference',
  '',
  '_Generated from the node registry — run `npm run docs --workspace client` after adding nodes._',
  '',
  `ArduForge ships **${allNodeDefs.length} nodes** across ${byCategory.size} categories.`,
  '',
  '## Contents',
  '',
];

for (const [category, defs] of byCategory) {
  lines.push(`- [${CATEGORY[category].label}](#${CATEGORY[category].label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}) — ${defs.length} nodes`);
}
lines.push('');

for (const [category, defs] of byCategory) {
  lines.push(`## ${CATEGORY[category].label}`, '');
  for (const def of defs.slice().sort((a, b) => a.label.localeCompare(b.label))) {
    lines.push(`### ${def.label}`, '');
    lines.push(def.description, '');
    const bits = [`\`${def.id}\``, `kind: ${def.kind}`];
    const outs = execOuts(def);
    if (def.execIn) bits.push('has execution input');
    if (outs.length > 0) bits.push(`execution outputs: ${outs.join(', ')}`);
    lines.push(bits.join(' · '), '');

    const ins = inputPorts(def);
    if (ins.length > 0) {
      lines.push('| Input | Type | Default |', '|---|---|---|');
      for (const port of ins) {
        const dflt = port.literal === undefined ? '—' : String(port.literal.default);
        lines.push(`| ${port.label} | \`${port.type}\` | ${dflt} |`);
      }
      lines.push('');
    }
    const outsData = outputPorts(def);
    if (outsData.length > 0) {
      lines.push('| Output | Type |', '|---|---|');
      for (const port of outsData) lines.push(`| ${port.label} | \`${port.type}\` |`);
      lines.push('');
    }
    if (def.config?.length) {
      lines.push('| Setting | Default |', '|---|---|');
      for (const field of def.config) lines.push(`| ${field.label} | ${String(field.default)} |`);
      lines.push('');
    }
    if (def.requires?.libraries?.length) {
      lines.push(`**Library:** ${def.requires.libraries.join(', ')}`, '');
    }
  }
}

writeFileSync(fileURLToPath(new URL('../../docs/node-reference.md', import.meta.url)), lines.join('\n'));
console.log(`wrote docs/node-reference.md (${allNodeDefs.length} nodes)`);
