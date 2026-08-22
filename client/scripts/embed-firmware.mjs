/**
 * Generates client/src/codegen/awrylinkSource.ts from firmware/AwryLink/.
 *
 * The firmware is the canonical copy; the client only needs it as a string so
 * it can be sent alongside the sketch to POST /api/compile. A test asserts the
 * generated file is current, so the two can never drift silently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../firmware/AwryLink/', import.meta.url));
const header = readFileSync(`${root}AwryLink.h`, 'utf8');
const source = readFileSync(`${root}AwryLink.cpp`, 'utf8');

const out = `/* GENERATED FILE — do not edit.
 * Run \`npm run embed:firmware --workspace client\` after changing
 * firmware/AwryLink/. The firmware directory is the canonical copy.
 */

export const AWRYLINK_HEADER = ${JSON.stringify(header)};

export const AWRYLINK_SOURCE = ${JSON.stringify(source)};

export const AWRYLINK_FILES = [
  { name: 'AwryLink.h', content: AWRYLINK_HEADER },
  { name: 'AwryLink.cpp', content: AWRYLINK_SOURCE },
] as const;
`;

writeFileSync(fileURLToPath(new URL('../src/codegen/awrylinkSource.ts', import.meta.url)), out);
console.log('embedded AwryLink firmware');
