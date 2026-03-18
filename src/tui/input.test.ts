import { describe, it, expect } from 'vitest';
import { parseKeyInput } from './input.js';

describe('parseKeyInput', () => {
  it('parses q as suspend_all', () => {
    const event = parseKeyInput(Buffer.from('q'));
    expect(event).toEqual({ action: 'suspend_all' });
  });

  it('parses Ctrl+C as suspend_all', () => {
    const event = parseKeyInput(Buffer.from('\x03'));
    expect(event).toEqual({ action: 'suspend_all' });
  });

  it('parses Tab as next_session', () => {
    const event = parseKeyInput(Buffer.from('\t'));
    expect(event).toEqual({ action: 'next_session' });
  });

  it('parses Shift+Tab as prev_session', () => {
    const event = parseKeyInput(Buffer.from('\x1b[Z'));
    expect(event).toEqual({ action: 'prev_session' });
  });

  it('parses n as new_session', () => {
    const event = parseKeyInput(Buffer.from('n'));
    expect(event).toEqual({ action: 'new_session' });
  });

  it('parses d as delete_session', () => {
    const event = parseKeyInput(Buffer.from('d'));
    expect(event).toEqual({ action: 'delete_session' });
  });

  it('parses ? as help', () => {
    const event = parseKeyInput(Buffer.from('?'));
    expect(event).toEqual({ action: 'help' });
  });

  it('parses digits 1-9 as jump_to_session', () => {
    for (let i = 1; i <= 9; i++) {
      const event = parseKeyInput(Buffer.from(String(i)));
      expect(event).toEqual({ action: 'jump_to_session', sessionNumber: i });
    }
  });

  it('parses Q as quit', () => {
    const event = parseKeyInput(Buffer.from('Q'));
    expect(event).toEqual({ action: 'quit' });
  });

  it('parses R as resume_all', () => {
    const event = parseKeyInput(Buffer.from('R'));
    expect(event).toEqual({ action: 'resume_all' });
  });

  it('returns null for unrecognized input', () => {
    expect(parseKeyInput(Buffer.from('x'))).toBeNull();
    expect(parseKeyInput(Buffer.from('A'))).toBeNull();
    expect(parseKeyInput(Buffer.from('0'))).toBeNull();
  });
});
