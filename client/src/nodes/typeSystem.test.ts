import { describe, expect, it } from 'vitest';
import { canConnectTypes, castNote } from '@/nodes/typeSystem';
import type { PortType } from '@/nodes/types';

describe('canConnectTypes', () => {
  it('allows identical types', () => {
    for (const type of ['bool', 'int', 'float', 'string', 'pin', 'exec'] as PortType[]) {
      expect(canConnectTypes(type, type).ok).toBe(true);
    }
  });

  it('allows the implicit casts the plan permits', () => {
    // §Phase 3: int->float, bool->int, int->bool, anything->string.
    expect(canConnectTypes('int', 'float').ok).toBe(true);
    expect(canConnectTypes('bool', 'int').ok).toBe(true);
    expect(canConnectTypes('int', 'bool').ok).toBe(true);
    expect(canConnectTypes('float', 'string').ok).toBe(true);
    expect(canConnectTypes('bool', 'string').ok).toBe(true);
  });

  it('treats pin as an int subtype', () => {
    expect(canConnectTypes('pin', 'int').ok).toBe(true);
    expect(canConnectTypes('int', 'pin').ok).toBe(true);
  });

  it('rejects string into a numeric input, with a reason', () => {
    // This exact rejection is the Phase 3 gate.
    const verdict = canConnectTypes('string', 'int');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/string/i);
      expect(verdict.reason).toMatch(/integer/i);
    }
  });

  it('rejects narrowing a float to an int', () => {
    expect(canConnectTypes('float', 'int').ok).toBe(false);
    expect(canConnectTypes('float', 'bool').ok).toBe(false);
  });

  it('never mixes exec with data in either direction', () => {
    for (const type of ['bool', 'int', 'float', 'string', 'pin', 'any'] as PortType[]) {
      expect(canConnectTypes('exec', type).ok).toBe(false);
      expect(canConnectTypes(type, 'exec').ok).toBe(false);
    }
  });

  it('explains the conversion when one happens', () => {
    expect(castNote('int', 'string')).toMatch(/String\(\)/);
    expect(castNote('bool', 'int')).toMatch(/1/);
    expect(castNote('int', 'bool')).toMatch(/non-zero/);
    expect(castNote('int', 'int')).toBeNull();
  });
});
