# Incident handoff board (capstone)

Net-new capstone app: record an operational handoff, see it on the board, and acknowledge it. Specified by `openspec/changes/capstone-incident-handoff-board/` (parent issue #7). Agent rules: [AGENTS.md](AGENTS.md).

```powershell
npm ci
npm run check    # lint + tests
npm start        # after the API task: STORAGE_BACKEND=memory|file|azure
```

Layers: `src/contract` (entity rules) <- `src/storage` (port + adapters) <- `src/server` (HTTP) ; `public/` (browser UI) talks HTTP only.

## Display language

The board defaults to Normal language and includes a keyboard-accessible
Gen Z/Alpha mode. The preference is stored in browser `localStorage`. Vibe
translations come from a static client-side dictionary and affect display copy
only: API routes, request fields, handoff state values, and accessible action
names remain unchanged.
