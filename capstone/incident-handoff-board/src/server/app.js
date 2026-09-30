import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { acknowledge, createHandoff, sortHandoffs, validateNewHandoff } from '../contract/handoff.js';
import { StorageUnavailableError } from '../storage/port.js';

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const defaultPublicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

function sendError(res, status, code, message, details) {
  const error = details ? { code, message, details } : { code, message };
  return res.status(status).json({ error });
}

/**
 * @param {{store: import('../storage/port.js').HandoffStore, now?: () => Date,
 *   newId?: () => string, publicDir?: string}} options
 */
export function createApp({ store, now = () => new Date(), newId = randomUUID, publicDir = defaultPublicDir }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/ready', async (_req, res) => {
    try {
      await store.ping();
      res.json({ status: 'ready', checks: { storage: 'ok' } });
    } catch {
      res.status(503).json({ status: 'unavailable', checks: { storage: 'unavailable' } });
    }
  });

  app.get('/api/handoffs', async (_req, res) => {
    res.json({ handoffs: sortHandoffs(await store.list()) });
  });

  app.post('/api/handoffs', async (req, res) => {
    const result = validateNewHandoff(req.body);
    if (!result.ok) {
      return sendError(res, 400, 'validation_failed', 'Fix the highlighted fields and try again.', result.details);
    }
    const handoff = await store.create(createHandoff(result.value, { id: newId(), now: now() }));
    return res.status(201).json(handoff);
  });

  app.post('/api/handoffs/:id/acknowledge', async (req, res) => {
    const { id } = req.params;
    const updated = ID_PATTERN.test(id) ? await store.update(id, (current) => acknowledge(current, now())) : null;
    if (!updated) {
      return sendError(res, 404, 'not_found', 'No handoff exists with that identifier.');
    }
    return res.json(updated);
  });

  app.use(express.static(publicDir));

  app.use('/api', (_req, res) => sendError(res, 404, 'not_found', 'Unknown API route.'));

  // Express identifies error handlers by their four-argument signature.
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      return sendError(res, 400, 'validation_failed', 'Request body must be valid JSON.', []);
    }
    if (err?.type === 'entity.too.large') {
      return sendError(res, 413, 'payload_too_large', 'Request body is too large.');
    }
    if (err instanceof StorageUnavailableError) {
      return sendError(res, 503, 'storage_unavailable', 'Storage is temporarily unavailable. Try again.');
    }
    console.error(err);
    return sendError(res, 500, 'internal_error', 'Unexpected error.');
  });

  return app;
}

