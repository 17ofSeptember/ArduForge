/**
 * AUDIT Pass 1 item 3 — inbound WS message decoding.
 *
 * The bug this guards: `[Buffer('{"t":"pi'), Buffer('ng"}')].toString()`
 * returns `{"t":"pi,ng"}`. A comma appears out of nowhere at the fragment
 * boundary, so a split frame comes back corrupted rather than rejected.
 */
import { describe, it, expect } from 'vitest';
import { rawDataToString } from '@/ws/rawData.js';

describe('rawDataToString', () => {
  it('decodes a single Buffer', () => {
    expect(rawDataToString(Buffer.from('{"t":"ping"}'))).toBe('{"t":"ping"}');
  });

  it('joins a fragmented message without inserting a separator', () => {
    const parts = [Buffer.from('{"t":"pi'), Buffer.from('ng"}')];
    expect(rawDataToString(parts)).toBe('{"t":"ping"}');
    // The exact regression: the naive path produced a comma here.
    expect(rawDataToString(parts)).not.toContain(',');
  });

  it('joins a message split across three fragments mid-token', () => {
    const parts = ['{"t":"set', 'Var","name":"ga', 'in","value":2}'].map((s) => Buffer.from(s));
    const decoded = rawDataToString(parts);
    expect(decoded).toBe('{"t":"setVar","name":"gain","value":2}');
    expect(JSON.parse(decoded)).toEqual({ t: 'setVar', name: 'gain', value: 2 });
  });

  it('decodes an ArrayBuffer rather than stringifying the object', () => {
    const source = Buffer.from('{"t":"close"}');
    const ab = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    expect(rawDataToString(ab)).toBe('{"t":"close"}');
    expect(rawDataToString(ab)).not.toContain('[object');
  });

  it('round-trips multi-byte UTF-8 split across a fragment boundary', () => {
    const whole = Buffer.from('{"t":"log","text":"°C"}', 'utf8');
    // Split inside the two-byte ° so a per-fragment decode would mangle it.
    const cut = whole.indexOf(Buffer.from('°', 'utf8')) + 1;
    const parts = [whole.subarray(0, cut), whole.subarray(cut)];
    expect(rawDataToString(parts)).toBe('{"t":"log","text":"°C"}');
  });

  it('returns an empty string for an empty message rather than throwing', () => {
    expect(rawDataToString(Buffer.alloc(0))).toBe('');
    expect(rawDataToString([])).toBe('');
  });
});
