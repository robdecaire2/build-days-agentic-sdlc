export const STATES = Object.freeze({ OPEN: 'open', ACKNOWLEDGED: 'acknowledged' });

export const LIMITS = Object.freeze({ service: 80, summary: 500, nextAction: 500 });

const FIELDS = Object.keys(LIMITS);

/**
 * Validate untrusted input for a new handoff.
 * @param {unknown} input
 * @returns {{ok: true, value: {service: string, summary: string, nextAction: string}} |
 *   {ok: false, details: {field: string, message: string}[]}}
 */
export function validateNewHandoff(input) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const details = [];
  const value = {};

  for (const field of FIELDS) {
    const raw = source[field];
    if (typeof raw !== 'string') {
      details.push({ field, message: `${field} is required and must be text.` });
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      details.push({ field, message: `${field} must not be blank.` });
    } else if (trimmed.length > LIMITS[field]) {
      details.push({ field, message: `${field} must be at most ${LIMITS[field]} characters.` });
    } else {
      value[field] = trimmed;
    }
  }

  return details.length > 0 ? { ok: false, details } : { ok: true, value };
}

/**
 * Build a new open handoff from validated input.
 * @param {{service: string, summary: string, nextAction: string}} value
 * @param {{id: string, now: Date}} context
 */
export function createHandoff(value, { id, now }) {
  const timestamp = now.toISOString();
  return {
    id,
    service: value.service,
    summary: value.summary,
    nextAction: value.nextAction,
    state: STATES.OPEN,
    createdAt: timestamp,
    updatedAt: timestamp,
    acknowledgedAt: null,
  };
}

/** Move an open handoff to acknowledged. Returns a new object. */
export function acknowledge(handoff, now) {
  const timestamp = now.toISOString();
  return { ...handoff, state: STATES.ACKNOWLEDGED, acknowledgedAt: timestamp, updatedAt: timestamp };
}

/** Deterministic board order: newest createdAt first, then id ascending. */
export function compareHandoffs(a, b) {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortHandoffs(handoffs) {
  return [...handoffs].sort(compareHandoffs);
}
