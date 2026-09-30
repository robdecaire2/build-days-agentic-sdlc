// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBoard } from '../../public/app.js';

describe('mountBoard', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="test-root"></div>';
  });

  it('shows a loading message before the empty state', async () => {
    let resolveList;
    const fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    mountBoard(document.getElementById('test-root'), { fetch });

    expect(document.body.textContent).toContain('Loading handoffs…');

    resolveList(jsonResponse({ handoffs: [] }));
    await flush();

    expect(document.body.textContent).toContain('No handoffs recorded yet.');
  });

  it('renders listed handoffs with state text and acknowledge action', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          sampleHandoff({ id: '1', service: 'checkout', state: 'open' }),
          sampleHandoff({
            id: '2',
            service: 'payments',
            state: 'acknowledged',
            acknowledgedAt: '2026-02-02T12:00:00.000Z',
            updatedAt: '2026-02-02T12:00:00.000Z',
          }),
        ],
      }),
    );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    expect(document.body.textContent).toContain('checkout');
    expect(document.body.textContent).toContain('Open');
    expect(document.body.textContent).toContain('payments');
    expect(document.body.textContent).toContain('Acknowledged');
    expect(screen().getByRole('button', { name: 'Acknowledge checkout' })).toBeTruthy();
  });

  it('submits a valid handoff, clears the form, and announces success', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ handoffs: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          sampleHandoff({
            id: 'new-1',
            service: 'checkout',
            summary: 'Latency elevated',
            nextAction: 'Watch p95',
          }),
          { status: 201 },
        ),
      );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    fillForm({
      service: ' checkout ',
      summary: 'Latency elevated',
      nextAction: 'Watch p95',
    });
    const submit = screen().getByRole('button', { name: 'Record handoff' });
    const form = submit.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(submit.disabled).toBe(true);
    await flush();

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/handoffs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          service: 'checkout',
          summary: 'Latency elevated',
          nextAction: 'Watch p95',
        }),
      }),
    );
    expect(screen().getByRole('status').textContent).toContain('Recorded handoff for checkout.');
    expect(screen().getByLabelText('Service').value).toBe('');
    expect(screen().getByLabelText('Summary').value).toBe('');
    expect(document.body.textContent).toContain('Open');
  });

  it('blocks invalid form input on the client and focuses the first invalid field', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ handoffs: [] }));

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    fillForm({
      service: '   ',
      summary: 'x'.repeat(501),
      nextAction: '',
    });

    const form = screen().getByRole('button', { name: 'Record handoff' }).closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const service = screen().getByLabelText('Service');
    const summary = screen().getByLabelText('Summary');
    const nextAction = screen().getByLabelText('Next action');
    expect(document.activeElement).toBe(service);
    expect(service.getAttribute('aria-invalid')).toBe('true');
    expect(summary.getAttribute('aria-invalid')).toBe('true');
    expect(nextAction.getAttribute('aria-invalid')).toBe('true');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps API validation details to field wiring and focuses the first invalid field', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ handoffs: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'validation_failed',
              message: 'Validation failed.',
              details: [
                { field: 'summary', message: 'summary must not be blank.' },
                { field: 'nextAction', message: 'nextAction must not be blank.' },
              ],
            },
          },
          { status: 400 },
        ),
      );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    fillForm({
      service: 'checkout',
      summary: 'Server says no',
      nextAction: 'Server says no',
    });
    const summary = screen().getByLabelText('Summary');
    const nextAction = screen().getByLabelText('Next action');

    const form = screen().getByRole('button', { name: 'Record handoff' }).closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(summary.getAttribute('aria-invalid')).toBe('true');
    expect(nextAction.getAttribute('aria-invalid')).toBe('true');
    expect(summary.getAttribute('aria-describedby')).toMatch(/summary-error$/);
    expect(nextAction.getAttribute('aria-describedby')).toMatch(/nextAction-error$/);
    expect(document.getElementById(summary.getAttribute('aria-describedby')).textContent).toContain(
      'summary must not be blank.',
    );
    expect(document.activeElement).toBe(summary);
  });

  it('preserves entered values after a failure and retries successfully', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ handoffs: [] }))
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce(
        jsonResponse(
          sampleHandoff({
            id: 'new-1',
            service: 'checkout',
            summary: 'Latency elevated',
            nextAction: 'Watch p95',
          }),
          { status: 201 },
        ),
      );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    fillForm({
      service: 'checkout',
      summary: 'Latency elevated',
      nextAction: 'Watch p95',
    });

    const form = screen().getByRole('button', { name: 'Record handoff' }).closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(screen().getByRole('alert').textContent).toContain('Could not record the handoff.');
    expect(screen().getByLabelText('Service').value).toBe('checkout');
    expect(screen().getByRole('button', { name: 'Retry' })).toBeTruthy();

    screen().getByRole('button', { name: 'Retry' }).click();
    await flush();

    expect(screen().getByRole('status').textContent).toContain('Recorded handoff for checkout.');
    expect(document.body.textContent).toContain('checkout');
  });

  it('acknowledges an open handoff and announces the update', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          handoffs: [sampleHandoff({ id: '1', service: 'checkout', state: 'open' })],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          sampleHandoff({
            id: '1',
            service: 'checkout',
            state: 'acknowledged',
            acknowledgedAt: '2026-02-02T12:00:00.000Z',
            updatedAt: '2026-02-02T12:00:00.000Z',
          }),
        ),
      );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    screen().getByRole('button', { name: 'Acknowledge checkout' }).click();
    await flush();

    expect(document.body.textContent).toContain('Acknowledged');
    expect(screen().queryByRole('button', { name: 'Acknowledge checkout' })).toBeNull();
    expect(screen().getByRole('status').textContent).toContain('Acknowledged handoff for checkout.');
  });

  it('shows an alert and refreshes the list after an acknowledgement conflict', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          handoffs: [sampleHandoff({ id: '1', service: 'checkout', state: 'open' })],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'already_acknowledged', message: 'Already acknowledged.' } },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          handoffs: [
            sampleHandoff({
              id: '1',
              service: 'checkout',
              state: 'acknowledged',
              acknowledgedAt: '2026-02-02T12:00:00.000Z',
              updatedAt: '2026-02-02T12:00:00.000Z',
            }),
          ],
        }),
      );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    screen().getByRole('button', { name: 'Acknowledge checkout' }).click();
    await flush();

    expect(screen().getByRole('alert').textContent).toContain('checkout was already acknowledged.');
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/handoffs');
    expect(document.body.textContent).toContain('Acknowledged');
  });

  it('supports keyboard-style acknowledgement via the focused button', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          handoffs: [sampleHandoff({ id: '1', service: 'checkout', state: 'open' })],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          sampleHandoff({
            id: '1',
            service: 'checkout',
            state: 'acknowledged',
            acknowledgedAt: '2026-02-02T12:00:00.000Z',
            updatedAt: '2026-02-02T12:00:00.000Z',
          }),
        ),
      );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    const button = screen().getByRole('button', { name: 'Acknowledge checkout' });
    button.focus();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(document.body.textContent).toContain('Acknowledged');
  });

  it('switches display copy while keeping accessible action names plain', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          sampleHandoff({ id: '1', service: 'checkout', state: 'open' }),
          sampleHandoff({
            id: '2',
            service: 'payments',
            state: 'acknowledged',
            acknowledgedAt: '2026-02-02T12:00:00.000Z',
          }),
        ],
      }),
    );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();

    const vibeToggle = screen().getByRole('button', { name: 'Toggle Vibe mode' });
    expect(vibeToggle.getAttribute('aria-pressed')).toBe('false');
    vibeToggle.focus();
    vibeToggle.click();

    expect(document.body.textContent).toContain('Bet, I got this checkout');
    expect(document.body.textContent).toContain('No cap, fixed');
    expect(vibeToggle.textContent).toBe('Vibe mode: Gen Z/Alpha');
    expect(vibeToggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen().getByRole('button', { name: 'Acknowledge checkout' })).toBeTruthy();
    expect(screen().getByRole('button', { name: 'Record handoff' }).textContent).toBe('Send it');
  });

  it('persists the language choice across a remount', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ handoffs: [] }));
    const root = document.getElementById('test-root');

    mountBoard(root, { fetch });
    await flush();
    screen().getByRole('button', { name: 'Toggle Vibe mode' }).click();

    mountBoard(root, { fetch });
    await flush();

    expect(screen().getByRole('button', { name: 'Toggle Vibe mode' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.body.textContent).toContain('No handoffs in the chat yet.');
  });

  it('keeps the API contract unchanged in Vibe mode', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          handoffs: [sampleHandoff({ id: 'handoff-1', service: 'checkout', state: 'open' })],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          sampleHandoff({
            id: 'handoff-1',
            service: 'checkout',
            state: 'acknowledged',
            acknowledgedAt: '2026-02-02T12:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          sampleHandoff({
            id: 'handoff-2',
            service: 'payments',
            summary: 'Latency elevated',
            nextAction: 'Watch p95',
          }),
          { status: 201 },
        ),
      );

    mountBoard(document.getElementById('test-root'), { fetch });
    await flush();
    screen().getByRole('button', { name: 'Toggle Vibe mode' }).click();

    screen().getByRole('button', { name: 'Acknowledge checkout' }).click();
    await flush();
    fillForm({
      service: 'payments',
      summary: 'Latency elevated',
      nextAction: 'Watch p95',
    });
    screen()
      .getByRole('button', { name: 'Record handoff' })
      .closest('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(fetch).toHaveBeenNthCalledWith(2, '/api/handoffs/handoff-1/acknowledge', {
      method: 'POST',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/handoffs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          service: 'payments',
          summary: 'Latency elevated',
          nextAction: 'Watch p95',
        }),
      }),
    );
  });
});

function screen() {
  return {
    getByLabelText(labelText) {
      const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === labelText);
      if (!label) throw new Error(`Missing label: ${labelText}`);
      return document.getElementById(label.htmlFor);
    },
    getByRole(role, { name } = {}) {
      const matches = queryAllByRole(role).filter((element) => {
        if (!name) return true;
        return getAccessibleName(element) === name;
      });
      if (matches.length === 0) {
        throw new Error(`Missing role=${role} name=${name || '*'}`);
      }
      return matches[0];
    },
    queryByRole(role, { name } = {}) {
      return queryAllByRole(role).find((element) => !name || getAccessibleName(element) === name) || null;
    },
  };
}

function queryAllByRole(role) {
  if (role === 'button') {
    return [...document.querySelectorAll('button')];
  }
  if (role === 'status' || role === 'alert') {
    return [...document.querySelectorAll(`[role="${role}"]`)];
  }
  return [];
}

function getAccessibleName(element) {
  return element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ');
}

function fillForm(values) {
  screen().getByLabelText('Service').value = values.service;
  screen().getByLabelText('Summary').value = values.summary;
  screen().getByLabelText('Next action').value = values.nextAction;
}

function sampleHandoff(overrides = {}) {
  return {
    id: 'handoff-1',
    service: 'checkout',
    summary: 'Latency elevated',
    nextAction: 'Watch p95',
    state: 'open',
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    acknowledgedAt: null,
    ...overrides,
  };
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}
