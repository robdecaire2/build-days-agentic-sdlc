# Incident handoff board agent guide

Net-new capstone app (issue #7). Read `../AGENTS.md`, root `AGENTS.md`/`DESIGN.md`, and `openspec/changes/capstone-incident-handoff-board/` first. Do not touch `src/**`, existing `tests/**`, or `openspec/changes/feedback-status/**`.

## Layout and ownership

| Path | Owner task |
|---|---|
| `package.json`, lockfile, `eslint.config.js`, `vitest.config.js`, `src/contract/**`, `src/storage/port.js`, `src/storage/memory.js` | 1 |
| `src/server/**`, `src/storage/file.js`, `src/storage/table.js` | 2 |
| `public/**` | 3 |
| `scripts/**` | 4 |
| `infra/**` | 5 |

Only the owning task edits its paths; shared manifests change only in Task 1 (or a later task that explicitly takes ownership in its issue).

## Rules

- Dependency direction: `contract` <- `server`/adapters; `public` talks HTTP only. The contract must not import Express, Azure SDK, or DOM types.
- Persist through the storage port; never call Azure SDK from `server` routes.
- Error shape: `{ "error": { "code", "message", "details?" } }`.
- Tests are deterministic (injected clock/ids, memory adapter, fake Azure client).
- Never commit secrets; Azure access is managed identity at runtime and OIDC in CI.

## Validation

```powershell
cd capstone/incident-handoff-board
npm ci
npm run check   # lint + tests
```
