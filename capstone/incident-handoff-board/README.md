# Incident handoff board (capstone)

Net-new capstone app: record an operational handoff, see it on the board, and acknowledge it. Specified by `openspec/changes/capstone-incident-handoff-board/` (parent issue #7). Agent rules: [AGENTS.md](AGENTS.md).

```powershell
npm ci
npm run check    # lint + tests
npm start        # after the API task: STORAGE_BACKEND=memory|file|azure
```

Layers: `src/contract` (entity rules) <- `src/storage` (port + adapters) <- `src/server` (HTTP) ; `public/` (browser UI) talks HTTP only.

## CI/CD pipeline (headline)

| Stage | Workflow | Trigger | Gate / permissions | Artifacts |
|---|---|---|---|---|
| Validate | `capstone-incident-handoff-ci.yml` | PR and push to main (path-scoped to `capstone/incident-handoff-board/**`), `workflow_dispatch` | `contents: read`; lint, unit/API/UI tests, start server, smoke (health, ready, create-to-acknowledge); Bicep build/lint job | `capstone-incident-handoff-package` zip; diagnostics log on failure; step summary |
| Deploy | `capstone-incident-handoff-deploy.yml` | `workflow_dispatch` only, `mode` = `what-if` (default) or `deploy` | config guard (skips with "NOT performed" when OIDC variables are missing); GitHub environment `capstone-incident-handoff`; `id-token: write` only in the gated job; smoke after deploy; rollback summary on failure | package zip, deployment summary |
| Report | `capstone-handoff-evidence.lock.yml` (GH-AW, source `.md`) | `workflow_dispatch` with `issue` | read-only; exactly one `add-comment` safe output | comment on the parent issue summarising runs |

Honest limits:
- **Deploy target for evidence was LOCAL.** The app was run in production mode (`NODE_ENV=production`, file storage) on `http://127.0.0.1:4317` and `scripts/smoke.mjs` passed (`health and readiness ok`, `create-to-acknowledge ok`, exit 0); a repeat acknowledge returned HTTP 409. There is no compile step (plain ESM JavaScript), so "build" means the packaged zip artifact.
- **Nothing was run in Azure.** The fork has no environment, variables or secrets. Deploy run 36764450548 (`workflow_dispatch`) reached the guard, reported "Azure deployment NOT performed" and skipped the deploy job. `az deployment group validate`/`what-if` were not run; only `az bicep build`/`lint` ran.
- `pull_request`/`push` events do not start runs on this fork, so CI receipts are `workflow_dispatch` runs.
- Easter egg: a "Vibe mode" UI toggle (issue #32) swaps display copy only; API fields and states are unchanged.
