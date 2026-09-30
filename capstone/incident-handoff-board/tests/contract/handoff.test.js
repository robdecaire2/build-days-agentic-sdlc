import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  STATES,
  acknowledge,
  compareHandoffs,
  createHandoff,
  sortHandoffs,
  validateNewHandoff,
} from '../../src/contract/handoff.js';

const valid = { service: ' checkout ', summary: 'Latency elevated', nextAction: 'Watch p95' };

describe('validateNewHandoff', () => {
  it('trims and accepts valid input', () => {
    expect(validateNewHandoff(valid)).toEqual({
      ok: true,
      value: { service: 'checkout', summary: 'Latency elevated', nextAction: 'Watch p95' },
    });
  });

  it.each([null, undefined, 'text', [], 42])('rejects a non-object body: %s', (body) => {
    const result = validateNewHandoff(body);
    expect(result.ok).toBe(false);
    expect(result.details.map((d) => d.field)).toEqual(['service', 'summary', 'nextAction']);
  });

  it('rejects missing, non-string, blank and over-long fields with per-field messages', () => {
    const result = validateNewHandoff({
      service: 7,
      summary: '   ',
      nextAction: 'x'.repeat(LIMITS.nextAction + 1),
    });
    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      { field: 'service', message: 'service is required and must be text.' },
      { field: 'summary', message: 'summary must not be blank.' },
      { field: 'nextAction', message: `nextAction must be at most ${LIMITS.nextAction} characters.` },
    ]);
  });

  it('accepts values exactly at the limit', () => {
    const result = validateNewHandoff({
      service: 's'.repeat(LIMITS.service),
      summary: 'a'.repeat(LIMITS.summary),
      nextAction: 'n',
    });
    expect(result.ok).toBe(true);
  });
});

describe('handoff lifecycle', () => {
  const now = new Date('2026-01-01T10:00:00.000Z');
  const later = new Date('2026-01-01T11:00:00.000Z');
  const value = validateNewHandoff(valid).value;

  it('creates an open handoff with equal timestamps and no acknowledgement', () => {
    const handoff = createHandoff(value, { id: 'h1', now });
    expect(handoff).toMatchObject({
      id: 'h1',
      state: STATES.OPEN,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      acknowledgedAt: null,
    });
  });

  it('moves open to acknowledged without mutating the input', () => {
    const open = createHandoff(value, { id: 'h1', now });
    const acknowledged = acknowledge(open, later);
    expect(acknowledged).toMatchObject({
      state: STATES.ACKNOWLEDGED,
      acknowledgedAt: later.toISOString(),
      updatedAt: later.toISOString(),
      createdAt: now.toISOString(),
    });
    expect(open.state).toBe(STATES.OPEN);
  });
});

describe('ordering', () => {
  const make = (id, createdAt) => ({ id, createdAt });

  it('orders newest first and breaks ties by id ascending', () => {
    const sorted = sortHandoffs([
      make('b', '2026-01-01T00:00:00.000Z'),
      make('c', '2026-01-02T00:00:00.000Z'),
      make('a', '2026-01-01T00:00:00.000Z'),
    ]);
    expect(sorted.map((h) => h.id)).toEqual(['c', 'a', 'b']);
  });

  it('reports equality for identical entries', () => {
    expect(compareHandoffs(make('a', 'x'), make('a', 'x'))).toBe(0);
  });
});
