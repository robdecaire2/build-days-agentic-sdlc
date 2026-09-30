const API_PATH = '/api/handoffs';
const STORAGE_KEY = 'incident-handoff-board-vibe-mode';
const LIMITS = Object.freeze({ service: 80, summary: 500, nextAction: 500 });
const FIELD_ORDER = ['service', 'summary', 'nextAction'];
const FIELD_LABELS = Object.freeze({
  service: 'Service',
  summary: 'Summary',
  nextAction: 'Next action',
});
const MODES = Object.freeze({ NORMAL: 'normal', VIBE: 'vibe' });
const KONAMI_CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const COPY = Object.freeze({
  [MODES.NORMAL]: {
    title: 'Incident handoff board',
    formHeading: 'Record a handoff',
    listHeading: 'Current handoffs',
    submitButton: 'Record handoff',
    toggleButton: 'Mode: Normal',
    loading: 'Loading handoffs…',
    empty: 'No handoffs recorded yet.',
    openState: 'Open',
    acknowledgedState: 'Acknowledged',
    acknowledgedAtConnector: ' at ',
    acknowledgeButton: 'Acknowledge',
    retryButton: 'Retry',
    createSuccess: (service) => `Recorded handoff for ${service}.`,
    createFailure: (message) => `Could not record the handoff. ${message}`,
    loadFailure: (message) => `Could not load the handoff board. ${message}`,
    acknowledgeSuccess: (service) => `Acknowledged handoff for ${service}.`,
    acknowledgeConflict: (service) => `${service} was already acknowledged.`,
    acknowledgeNotFound: (service) => `${service} could not be found for acknowledgement.`,
    acknowledgeFailure: (service, message) => `Could not acknowledge ${service}. ${message}`,
  },
  [MODES.VIBE]: {
    title: 'Incident pass the aux board',
    formHeading: 'Record a pass the aux',
    listHeading: 'Current passes on the aux',
    submitButton: 'Pass the aux',
    toggleButton: 'Mode: Vibe',
    loading: 'Loading the pass the aux board…',
    empty: 'No passes on the aux yet.',
    openState: 'Still live',
    acknowledgedState: 'No cap, fixed',
    acknowledgedAtConnector: ' at ',
    acknowledgeButton: 'Bet, I got this',
    retryButton: 'Run it back',
    createSuccess: (service) => `Pass the aux logged for ${service}.`,
    createFailure: (message) => `Could not log the pass the aux. ${message}`,
    loadFailure: (message) => `Could not load the pass the aux board. ${message}`,
    acknowledgeSuccess: (service) => `No cap, fixed for ${service}.`,
    acknowledgeConflict: (service) => `${service} is already no cap, fixed.`,
    acknowledgeNotFound: (service) => `${service} vanished before the fix landed.`,
    acknowledgeFailure: (service, message) => `Could not lock in the fix for ${service}. ${message}`,
  },
});

let mountCount = 0;

export function mountBoard(root, { fetch = globalThis.fetch.bind(globalThis) } = {}) {
  if (!root) {
    throw new Error('mountBoard requires a root element.');
  }

  mountCount += 1;

  const idPrefix = `handoff-board-${mountCount}`;
  const documentRef = root.ownerDocument;
  const view = documentRef.defaultView;
  const pageHeading = documentRef.querySelector('main h1');
  const fieldRefs = new Map();
  const errorRefs = new Map();
  const state = {
    handoffs: [],
    mode: readMode(view?.localStorage),
    listState: 'loading',
    statusMessage: null,
    alertMessage: null,
  };
  let retryAction = null;
  let konamiIndex = 0;

  root.replaceChildren();

  const board = createElement(documentRef, 'div', { className: 'board' });
  const toolbar = createElement(documentRef, 'div', { className: 'toolbar' });
  const toggleButton = createElement(documentRef, 'button', {
    type: 'button',
    className: 'secondary',
    ariaLabel: 'Toggle vibe mode',
  });
  const messageSection = createElement(documentRef, 'div');
  const statusRegion = createElement(documentRef, 'p', {
    className: 'status-banner',
    role: 'status',
    ariaLive: 'polite',
  });
  const alertRegion = createElement(documentRef, 'div');
  const formSection = createElement(documentRef, 'section', { className: 'panel' });
  const formHeading = createElement(documentRef, 'h2');
  const listSection = createElement(documentRef, 'section', { className: 'panel' });
  const listHeading = createElement(documentRef, 'h2');
  const listStatus = createElement(documentRef, 'p', { className: 'list-status', role: 'status' });
  const handoffList = createElement(documentRef, 'ul', { className: 'handoff-list' });
  const form = createElement(documentRef, 'form');
  const submitButton = createElement(documentRef, 'button', {
    type: 'submit',
    ariaLabel: 'Record handoff',
  });

  toolbar.append(toggleButton);
  messageSection.append(statusRegion, alertRegion);
  formSection.append(formHeading, form);
  listSection.append(listHeading, listStatus, handoffList);
  board.append(toolbar, messageSection, formSection, listSection);
  root.append(board);

  for (const field of FIELD_ORDER) {
    const inputId = `${idPrefix}-${field}`;
    const errorId = `${inputId}-error`;
    const fieldWrap = createElement(documentRef, 'div', { className: 'field' });
    const label = createElement(documentRef, 'label', { for: inputId, text: FIELD_LABELS[field] });
    const input =
      field === 'service'
        ? createElement(documentRef, 'input', { id: inputId, name: field, type: 'text', maxLength: LIMITS[field] })
        : createElement(documentRef, 'textarea', { id: inputId, name: field, maxLength: LIMITS[field] });
    const error = createElement(documentRef, 'p', { id: errorId, className: 'field-error' });
    fieldRefs.set(field, input);
    errorRefs.set(field, error);
    fieldWrap.append(label, input, error);
    form.append(fieldWrap);
  }

  form.append(submitButton);

  toggleButton.addEventListener('click', () => {
    setMode(state.mode === MODES.NORMAL ? MODES.VIBE : MODES.NORMAL);
  });

  board.addEventListener('keydown', (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const expected = KONAMI_CODE[konamiIndex];
    if (key === expected) {
      konamiIndex += 1;
      if (konamiIndex === KONAMI_CODE.length) {
        konamiIndex = 0;
        setMode(state.mode === MODES.NORMAL ? MODES.VIBE : MODES.NORMAL);
      }
      return;
    }
    konamiIndex = key === KONAMI_CODE[0] ? 1 : 0;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(errorRefs, fieldRefs);
    setAlertMessage(null);
    setStatusMessage(null);

    const values = readFormValues(fieldRefs);
    const validation = validateForm(values);
    if (validation.details.length > 0) {
      applyFieldErrors(validation.details, fieldRefs, errorRefs);
      return;
    }

    await submitHandoff(validation.value);
  });

  function getCopy() {
    return COPY[state.mode];
  }

  function setMode(mode) {
    state.mode = mode === MODES.VIBE ? MODES.VIBE : MODES.NORMAL;
    writeMode(view?.localStorage, state.mode);
    renderStaticCopy();
    renderStatusMessage();
    renderAlertMessage();
    renderHandoffs();
  }

  function setStatusMessage(message) {
    state.statusMessage = message;
    renderStatusMessage();
  }

  function setAlertMessage(message) {
    state.alertMessage = message;
    renderAlertMessage();
  }

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
        throw new Error(body?.error?.message || 'Try again.');
      }

      state.handoffs = [body, ...state.handoffs.filter((handoff) => handoff.id !== body.id)];
      state.listState = state.handoffs.length > 0 ? 'ready' : 'empty';
      renderHandoffs();
      form.reset();
      clearFieldErrors(errorRefs, fieldRefs);
      setAlertMessage(null);
      setStatusMessage({ type: 'createSuccess', service: body.service });
    } catch (error) {
      retryAction = () => submitHandoff(payload);
      setAlertMessage({ type: 'createFailure', message: error.message });
    } finally {
      submitButton.disabled = false;
    }
  }

  async function loadHandoffs({ preserveAlert = false } = {}) {
    if (!preserveAlert) {
      setAlertMessage(null);
    }
    state.listState = 'loading';
    renderHandoffs();

    try {
      const response = await fetch(API_PATH);
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(body?.error?.message || 'Try again.');
      }

      state.handoffs = Array.isArray(body?.handoffs) ? body.handoffs : [];
      state.listState = state.handoffs.length > 0 ? 'ready' : 'empty';
      renderHandoffs();
    } catch (error) {
      state.handoffs = [];
      state.listState = 'loadError';
      renderHandoffs();
      setAlertMessage({ type: 'loadFailure', message: error.message });
    }
  }

  function renderStaticCopy() {
    const copy = getCopy();
    if (pageHeading) {
      pageHeading.textContent = copy.title;
    }
    documentRef.title = copy.title;
    formHeading.textContent = copy.formHeading;
    listHeading.textContent = copy.listHeading;
    submitButton.textContent = copy.submitButton;
    toggleButton.textContent = copy.toggleButton;
    toggleButton.setAttribute('aria-pressed', String(state.mode === MODES.VIBE));
  }

  function renderStatusMessage() {
    const copy = getCopy();
    if (!state.statusMessage) {
      statusRegion.textContent = '';
      return;
    }
    if (state.statusMessage.type === 'createSuccess') {
      statusRegion.textContent = copy.createSuccess(state.statusMessage.service);
      return;
    }
    if (state.statusMessage.type === 'acknowledgeSuccess') {
      statusRegion.textContent = copy.acknowledgeSuccess(state.statusMessage.service);
      return;
    }
    statusRegion.textContent = '';
  }

  function renderAlertMessage() {
    const copy = getCopy();
    if (!state.alertMessage) {
      alertRegion.replaceChildren();
      return;
    }

    const alert = createElement(documentRef, 'div', { className: 'alert', role: 'alert' });
    const body = createElement(documentRef, 'p');

    if (state.alertMessage.type === 'createFailure') {
      body.textContent = copy.createFailure(state.alertMessage.message);
    } else if (state.alertMessage.type === 'loadFailure') {
      body.textContent = copy.loadFailure(state.alertMessage.message);
    } else if (state.alertMessage.type === 'acknowledgeConflict') {
      body.textContent = copy.acknowledgeConflict(state.alertMessage.service);
    } else if (state.alertMessage.type === 'acknowledgeNotFound') {
      body.textContent = copy.acknowledgeNotFound(state.alertMessage.service);
    } else {
      body.textContent = copy.acknowledgeFailure(state.alertMessage.service, state.alertMessage.message);
    }

    alert.append(body);

    if (retryAction) {
      const actions = createElement(documentRef, 'div', { className: 'alert-actions' });
      const button = createElement(documentRef, 'button', {
        type: 'button',
        className: 'secondary',
        text: copy.retryButton,
        ariaLabel: 'Retry',
      });
      button.addEventListener('click', retryAction);
      actions.append(button);
      alert.append(actions);
    }

    alertRegion.replaceChildren(alert);
  }

  function renderListStatus() {
    const copy = getCopy();
    if (state.listState === 'loading') {
      listStatus.textContent = copy.loading;
      return;
    }
    if (state.listState === 'empty') {
      listStatus.textContent = copy.empty;
      return;
    }
    if (state.listState === 'loadError') {
      listStatus.textContent = '';
      return;
    }
    listStatus.textContent = '';
  }

  function renderHandoffs() {
    renderListStatus();
    handoffList.replaceChildren();

    if (state.listState !== 'ready') {
      return;
    }

    for (const handoff of state.handoffs) {
      handoffList.append(renderHandoff(handoff));
    }
  }

  function renderHandoff(handoff) {
    const copy = getCopy();
    const item = createElement(documentRef, 'li', { className: 'handoff-card' });
    const heading = createElement(documentRef, 'h3', { text: handoff.service });
    const summary = createElement(documentRef, 'p');
    const nextAction = createElement(documentRef, 'p');
    const stateText = createElement(documentRef, 'p', { className: 'handoff-state' });
    const created = createElement(documentRef, 'p', { className: 'handoff-meta' });

    summary.append(createElement(documentRef, 'strong', { text: 'Summary: ' }), documentRef.createTextNode(handoff.summary));
    nextAction.append(
      createElement(documentRef, 'strong', { text: 'Next action: ' }),
      documentRef.createTextNode(handoff.nextAction),
    );
    created.append(
      createElement(documentRef, 'strong', { text: 'Created: ' }),
      createElement(documentRef, 'time', { dateTime: handoff.createdAt, text: handoff.createdAt }),
    );

    if (handoff.state === 'acknowledged') {
      stateText.append(
        documentRef.createTextNode(copy.acknowledgedState),
        documentRef.createTextNode(copy.acknowledgedAtConnector),
        createElement(documentRef, 'time', { dateTime: handoff.acknowledgedAt, text: handoff.acknowledgedAt }),
      );
      item.append(heading, summary, nextAction, stateText, created);
      return item;
    }

    stateText.textContent = copy.openState;
    const button = createElement(documentRef, 'button', {
      type: 'button',
      text: copy.acknowledgeButton,
      ariaLabel: `Acknowledge ${handoff.service}`,
    });
    button.addEventListener('click', () => acknowledgeHandoff(handoff, button));
    item.append(heading, summary, nextAction, stateText, created, button);
    return item;
  }

  async function acknowledgeHandoff(handoff, button) {
    button.disabled = true;
    retryAction = null;
    setAlertMessage(null);

    try {
      const response = await fetch(`${API_PATH}/${encodeURIComponent(handoff.id)}/acknowledge`, {
        method: 'POST',
      });
      const body = await readJson(response);

      if (!response.ok) {
        if (response.status === 409) {
          setAlertMessage({ type: 'acknowledgeConflict', service: handoff.service });
        } else if (response.status === 404) {
          setAlertMessage({ type: 'acknowledgeNotFound', service: handoff.service });
        } else {
          setAlertMessage({
            type: 'acknowledgeFailure',
            service: handoff.service,
            message: body?.error?.message || 'Try again.',
          });
        }
        await loadHandoffs({ preserveAlert: true });
        return;
      }

      state.handoffs = state.handoffs.map((entry) => (entry.id === body.id ? body : entry));
      state.listState = state.handoffs.length > 0 ? 'ready' : 'empty';
      renderHandoffs();
      setStatusMessage({ type: 'acknowledgeSuccess', service: body.service });
    } catch (error) {
      setAlertMessage({
        type: 'acknowledgeFailure',
        service: handoff.service,
        message: error.message,
      });
      await loadHandoffs({ preserveAlert: true });
    }
  }

  renderStaticCopy();
  renderStatusMessage();
  renderAlertMessage();
  renderHandoffs();
  loadHandoffs();

  return { refresh: loadHandoffs };
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

function readMode(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) === MODES.VIBE ? MODES.VIBE : MODES.NORMAL;
  } catch {
    return MODES.NORMAL;
  }
}

function writeMode(storage, mode) {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore unavailable storage and keep the current in-memory mode.
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createElement(documentRef, tagName, options = {}) {
  const element = documentRef.createElement(tagName);

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
