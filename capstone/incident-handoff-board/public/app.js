const API_PATH = '/api/handoffs';
const LIMITS = Object.freeze({ service: 80, summary: 500, nextAction: 500 });
const FIELD_ORDER = ['service', 'summary', 'nextAction'];
const FIELD_LABELS = Object.freeze({
  service: 'Service',
  summary: 'Summary',
  nextAction: 'Next action',
});
const LANGUAGE_STORAGE_KEY = 'incident-handoff-board-language';
const LANGUAGE_MODES = Object.freeze({
  normal: 'normal',
  vibe: 'vibe',
});
const COPY = Object.freeze({
  normal: Object.freeze({
    formHeading: 'Record a handoff',
    listHeading: 'Current handoffs',
    submit: 'Record handoff',
    loading: 'Loading handoffs…',
    empty: 'No handoffs recorded yet.',
    open: 'Open',
    acknowledged: 'Acknowledged',
    acknowledge: 'Acknowledge',
  }),
  vibe: Object.freeze({
    formHeading: 'Drop a handoff',
    listHeading: "What's live",
    submit: 'Send it',
    loading: 'Loading the lore…',
    empty: 'No handoffs in the chat yet.',
    open: 'Still cooking',
    acknowledged: 'No cap, fixed',
    acknowledge: 'Bet, I got this',
  }),
});

let mountCount = 0;

export function mountBoard(
  root,
  { fetch = globalThis.fetch.bind(globalThis), storage = globalThis.localStorage } = {},
) {
  if (!root) {
    throw new Error('mountBoard requires a root element.');
  }

  mountCount += 1;
  const idPrefix = `handoff-board-${mountCount}`;
  const fieldRefs = new Map();
  const errorRefs = new Map();
  let handoffs = [];
  let retryAction = null;
  let languageMode = LANGUAGE_MODES.normal;

  root.replaceChildren();

  const board = createElement('div', { className: 'board' });
  const messageSection = createElement('div');
  const statusRegion = createElement('p', {
    className: 'status-banner',
    role: 'status',
    ariaLive: 'polite',
  });
  const alertRegion = createElement('div');
  const languageToggle = createElement('button', {
    type: 'button',
    className: 'secondary language-toggle',
    text: 'Vibe mode: Normal',
    ariaLabel: 'Toggle Vibe mode',
  });
  const formSection = createElement('section', { className: 'panel' });
  const listSection = createElement('section', { className: 'panel' });
  const formHeading = createElement('h2');
  const listHeading = createElement('h2');
  const listStatus = createElement('p', { className: 'list-status', role: 'status' });
  const handoffList = createElement('ul', { className: 'handoff-list' });
  const form = createElement('form');
  const submitButton = createElement('button', {
    type: 'submit',
    text: COPY.normal.submit,
    ariaLabel: 'Record handoff',
  });

  messageSection.append(statusRegion, alertRegion);
  formSection.append(formHeading, form);
  listSection.append(listHeading, listStatus, handoffList);
  board.append(languageToggle, messageSection, formSection, listSection);
  root.append(board);

  languageToggle.addEventListener('click', () => {
    languageMode =
      languageMode === LANGUAGE_MODES.normal ? LANGUAGE_MODES.vibe : LANGUAGE_MODES.normal;
    applyLanguage();
    persistLanguageMode(storage, languageMode, alertRegion);
  });

  for (const field of FIELD_ORDER) {
    const inputId = `${idPrefix}-${field}`;
    const errorId = `${inputId}-error`;
    const fieldWrap = createElement('div', { className: 'field' });
    const label = createElement('label', { for: inputId, text: FIELD_LABELS[field] });
    const input =
      field === 'service'
        ? createElement('input', { id: inputId, name: field, type: 'text', maxLength: LIMITS[field] })
        : createElement('textarea', { id: inputId, name: field, maxLength: LIMITS[field] });
    const error = createElement('p', { id: errorId, className: 'field-error' });
    fieldRefs.set(field, input);
    errorRefs.set(field, error);
    fieldWrap.append(label, input, error);
    form.append(fieldWrap);
  }

  form.append(submitButton);
  languageMode = readLanguageMode(storage, alertRegion);
  applyLanguage();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(errorRefs, fieldRefs);
    clearAlert(alertRegion);
    announce(statusRegion, '');

    const values = readFormValues(fieldRefs);
    const validation = validateForm(values);
    if (validation.details.length > 0) {
      applyFieldErrors(validation.details, fieldRefs, errorRefs);
      return;
    }

    await submitHandoff(validation.value);
  });

  async function submitHandoff(payload) {
    retryAction = null;
    submitButton.disabled = true;

    try {
      const response = await fetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(response);

      if (response.status === 400 && body?.error?.code === 'validation_failed' && Array.isArray(body.error.details)) {
        applyFieldErrors(body.error.details, fieldRefs, errorRefs);
        return;
      }

      if (!response.ok) {
        throw new Error(body?.error?.message || 'The handoff could not be recorded.');
      }

      handoffs = [body, ...handoffs.filter((handoff) => handoff.id !== body.id)];
      renderHandoffs();
      form.reset();
      clearFieldErrors(errorRefs, fieldRefs);
      clearAlert(alertRegion);
      announce(statusRegion, `Recorded handoff for ${body.service}.`);
    } catch (error) {
      retryAction = () => submitHandoff(payload);
      showAlert(alertRegion, `Could not record the handoff. ${error.message}`, {
        label: 'Retry',
        onRetry: retryAction,
      });
    } finally {
      submitButton.disabled = false;
    }
  }

  async function loadHandoffs({ preserveAlert = false } = {}) {
    if (!preserveAlert) {
      clearAlert(alertRegion);
    }
    listStatus.textContent = copy().loading;
    handoffList.replaceChildren();

    try {
      const response = await fetch(API_PATH);
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(body?.error?.message || 'The handoffs could not be loaded.');
      }

      handoffs = Array.isArray(body?.handoffs) ? body.handoffs : [];
      renderHandoffs();
    } catch (error) {
      handoffs = [];
      handoffList.replaceChildren();
      listStatus.textContent = 'Unable to load handoffs.';
      showAlert(alertRegion, `Could not load the handoff board. ${error.message}`, {
        label: 'Retry',
        onRetry: () => loadHandoffs(),
      });
    }
  }

  function renderHandoffs() {
    handoffList.replaceChildren();

    if (handoffs.length === 0) {
      listStatus.textContent = copy().empty;
      return;
    }

    listStatus.textContent = '';
    for (const handoff of handoffs) {
      handoffList.append(renderHandoff(handoff));
    }
  }

  function renderHandoff(handoff) {
    const item = createElement('li', { className: 'handoff-card' });
    const heading = createElement('h3', { text: handoff.service });
    const summary = createElement('p');
    const nextAction = createElement('p');
    const state = createElement('p', { className: 'handoff-state' });
    const created = createElement('p', { className: 'handoff-meta' });

    summary.append(createElement('strong', { text: 'Summary: ' }), document.createTextNode(handoff.summary));
    nextAction.append(createElement('strong', { text: 'Next action: ' }), document.createTextNode(handoff.nextAction));
    created.append(
      createElement('strong', { text: 'Created: ' }),
      createElement('time', { dateTime: handoff.createdAt, text: handoff.createdAt }),
    );

    if (handoff.state === 'acknowledged') {
      state.append(
        document.createTextNode(copy().acknowledged),
        document.createTextNode(' at '),
        createElement('time', { dateTime: handoff.acknowledgedAt, text: handoff.acknowledgedAt }),
      );
    } else {
      state.textContent = copy().open;
      const button = createElement('button', {
        type: 'button',
        text: `${copy().acknowledge} ${handoff.service}`,
        ariaLabel: `Acknowledge ${handoff.service}`,
      });
      button.addEventListener('click', () => acknowledgeHandoff(handoff, button));
      item.append(heading, summary, nextAction, state, created, button);
      return item;
    }

    item.append(heading, summary, nextAction, state, created);
    return item;
  }

  function copy() {
    return COPY[languageMode];
  }

  function applyLanguage() {
    const activeCopy = copy();
    formHeading.textContent = activeCopy.formHeading;
    listHeading.textContent = activeCopy.listHeading;
    submitButton.textContent = activeCopy.submit;
    languageToggle.textContent =
      languageMode === LANGUAGE_MODES.vibe ? 'Vibe mode: Gen Z/Alpha' : 'Vibe mode: Normal';
    languageToggle.setAttribute('aria-pressed', String(languageMode === LANGUAGE_MODES.vibe));
    renderHandoffs();
  }

  async function acknowledgeHandoff(handoff, button) {
    button.disabled = true;
    clearAlert(alertRegion);

    try {
      const response = await fetch(`${API_PATH}/${encodeURIComponent(handoff.id)}/acknowledge`, {
        method: 'POST',
      });
      const body = await readJson(response);

      if (!response.ok) {
        const problem = describeAcknowledgeFailure(response.status, handoff.service, body?.error?.message);
        showAlert(alertRegion, problem);
        await loadHandoffs({ preserveAlert: true });
        return;
      }

      handoffs = handoffs.map((entry) => (entry.id === body.id ? body : entry));
      renderHandoffs();
      announce(statusRegion, `Acknowledged handoff for ${body.service}.`);
    } catch (error) {
      showAlert(alertRegion, `Could not acknowledge ${handoff.service}. ${error.message}`);
      await loadHandoffs({ preserveAlert: true });
    }
  }

  loadHandoffs();

  return {
    refresh: loadHandoffs,
  };
}

function readFormValues(fieldRefs) {
  return Object.fromEntries([...fieldRefs.entries()].map(([field, element]) => [field, element.value]));
}

function validateForm(values) {
  const details = [];
  const value = {};

  for (const field of FIELD_ORDER) {
    const trimmed = values[field].trim();
    if (trimmed.length === 0) {
      details.push({ field, message: `${FIELD_LABELS[field]} must not be blank.` });
    } else if (trimmed.length > LIMITS[field]) {
      details.push({ field, message: `${FIELD_LABELS[field]} must be at most ${LIMITS[field]} characters.` });
    } else {
      value[field] = trimmed;
    }
  }

  return { details, value };
}

function applyFieldErrors(details, fieldRefs, errorRefs) {
  clearFieldErrors(errorRefs, fieldRefs);

  for (const detail of details) {
    const field = fieldRefs.get(detail.field);
    const error = errorRefs.get(detail.field);
    if (!field || !error) {
      continue;
    }
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', error.id);
    error.textContent = detail.message;
  }

  const first = details.map((detail) => fieldRefs.get(detail.field)).find(Boolean);
  first?.focus();
}

function clearFieldErrors(errorRefs, fieldRefs) {
  for (const [field, error] of errorRefs.entries()) {
    error.textContent = '';
    const input = fieldRefs.get(field);
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

function showAlert(container, message, action) {
  const alert = createElement('div', { className: 'alert', role: 'alert' });
  const body = createElement('p', { text: message });
  alert.append(body);

  if (action) {
    const actions = createElement('div', { className: 'alert-actions' });
    const button = createElement('button', {
      type: 'button',
      className: 'secondary',
      text: action.label,
    });
    button.addEventListener('click', action.onRetry);
    actions.append(button);
    alert.append(actions);
  }

  container.replaceChildren(alert);
}

function clearAlert(container) {
  container.replaceChildren();
}

function announce(region, message) {
  region.textContent = message;
}

function describeAcknowledgeFailure(status, service, fallbackMessage) {
  if (status === 409) {
    return `${service} was already acknowledged.`;
  }
  if (status === 404) {
    return `${service} could not be found for acknowledgement.`;
  }
  return `Could not acknowledge ${service}. ${fallbackMessage || 'Try again.'}`;
}

function readLanguageMode(storage, alertRegion) {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) === LANGUAGE_MODES.vibe
      ? LANGUAGE_MODES.vibe
      : LANGUAGE_MODES.normal;
  } catch (error) {
    showAlert(alertRegion, `Could not load the display language preference. ${error.message}`);
    return LANGUAGE_MODES.normal;
  }
}

function persistLanguageMode(storage, mode, alertRegion) {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, mode);
  } catch (error) {
    showAlert(alertRegion, `Could not save the display language preference. ${error.message}`);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.className) {
    element.className = options.className;
  }
  if (options.id) {
    element.id = options.id;
  }
  if (options.name) {
    element.name = options.name;
  }
  if (options.type) {
    element.type = options.type;
  }
  if (options.maxLength) {
    element.maxLength = options.maxLength;
  }
  if (options.role) {
    element.setAttribute('role', options.role);
  }
  if (options.ariaLive) {
    element.setAttribute('aria-live', options.ariaLive);
  }
  if (options.ariaLabel) {
    element.setAttribute('aria-label', options.ariaLabel);
  }
  if (options.for) {
    element.htmlFor = options.for;
  }
  if (options.dateTime) {
    element.dateTime = options.dateTime;
  }
  if (options.text) {
    element.textContent = options.text;
  }

  return element;
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('board-root');
  if (root) {
    mountBoard(root);
  }
}
