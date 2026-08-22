import { describe, expect, it } from 'vitest';
import { command, parseFrame, MIN_TELEMETRY_MS } from '@/link/protocol.js';

describe('parseFrame', () => {
  it('reads a handshake', () => {
    const frame = parseFrame('H|awrylink,1,uno,0b4f425b');
    expect(frame).toEqual({
      kind: 'handshake',
      protocol: 'awrylink',
      version: 1,
      board: 'uno',
      sketchHash: '0b4f425b',
    });
  });

  it('reads a telemetry frame with several values', () => {
    const frame = parseFrame('T|12345,potValue=512,servoAngle=90');
    expect(frame.kind).toBe('telemetry');
    if (frame.kind !== 'telemetry') return;
    expect(frame.millis).toBe(12345);
    expect(frame.values.get('potValue')).toBe(512);
    expect(frame.values.get('servoAngle')).toBe(90);
  });

  it('reads negative and fractional telemetry values', () => {
    const frame = parseFrame('T|1,distance=-1.000,gain=0.25');
    if (frame.kind !== 'telemetry') throw new Error('expected telemetry');
    expect(frame.values.get('distance')).toBe(-1);
    expect(frame.values.get('gain')).toBe(0.25);
  });

  it('reads a telemetry frame carrying no values', () => {
    const frame = parseFrame('T|900');
    if (frame.kind !== 'telemetry') throw new Error('expected telemetry');
    expect(frame.values.size).toBe(0);
  });

  it('reads logs, errors, and pin replies', () => {
    expect(parseFrame('L|hello there')).toEqual({ kind: 'log', text: 'hello there' });
    expect(parseFrame('E|NOVAR,speed')).toEqual({ kind: 'error', code: 'NOVAR', detail: 'speed' });
    expect(parseFrame('R|13,1')).toEqual({ kind: 'digital', pin: 13, value: 1 });
    expect(parseFrame('N|0,512')).toEqual({ kind: 'analog', pin: 0, value: 512 });
    expect(parseFrame('P|9999')).toEqual({ kind: 'pong', millis: 9999 });
  });

  it('never throws on junk, so a board mid-reset cannot kill the link', () => {
    for (const junk of ['', 'x', '\x00\x01garbage', 'T', 'T|', '|||', 'Z|what']) {
      expect(() => parseFrame(junk)).not.toThrow();
    }
    expect(parseFrame('garbage').kind).toBe('unknown');
  });

  it('ignores malformed pairs inside an otherwise good frame', () => {
    const frame = parseFrame('T|10,good=1,broken,=2,alsogood=3');
    if (frame.kind !== 'telemetry') throw new Error('expected telemetry');
    expect(frame.values.get('good')).toBe(1);
    expect(frame.values.get('alsogood')).toBe(3);
    expect(frame.values.size).toBe(2);
  });
});

describe('command encoding', () => {
  it('builds the documented commands', () => {
    expect(command.handshake()).toBe('!H\n');
    expect(command.ping()).toBe('!P\n');
    expect(command.stopTelemetry()).toBe('!X\n');
    expect(command.setVar('speed', 120)).toBe('!S speed=120\n'.replace(' ', ''));
    expect(command.getVar('speed')).toBe('!Gspeed\n');
    expect(command.digitalWrite(13, 1)).toBe('!D13,1\n');
    expect(command.analogWrite(9, 200)).toBe('!A9,200\n');
    expect(command.digitalRead(2)).toBe('!R2\n');
    expect(command.analogRead(0)).toBe('!N0\n');
    expect(command.pinMode(7, 2)).toBe('!M7,2\n');
  });

  it('clamps telemetry to the minimum interval', () => {
    expect(command.startTelemetry(10)).toBe(`!T${MIN_TELEMETRY_MS}\n`);
    expect(command.startTelemetry(250)).toBe('!T250\n');
  });

  it('clamps analogWrite into the PWM range', () => {
    expect(command.analogWrite(9, 999)).toBe('!A9,255\n');
    expect(command.analogWrite(9, -5)).toBe('!A9,0\n');
  });

  it('refuses values that would corrupt the line protocol', () => {
    // The protocol has no escaping, so a newline or separator must be rejected
    // rather than silently producing two frames.
    expect(() => command.setVar('speed', 'a\nb')).toThrow();
    expect(() => command.setVar('a=b', 1)).toThrow();
    expect(() => command.setVar('a,b', 1)).toThrow();
    expect(() => command.setVar('a|b', 1)).toThrow();
  });
});
