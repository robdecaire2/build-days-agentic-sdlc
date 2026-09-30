# Application source guide

- `src/shared/contracts.ts` is the contract for client and server; change it first, then storage, API, and client.
- `FeedbackStorage` in `src/server/storage.ts` has in-memory and Azure Table adapters; keep behavior identical in both.
- API errors use the `ApiError` shape and existing codes in `src/server/app.ts`; new codes are plain strings owned by the task that maps them.
- Register new routes after the rate-limit middleware in `src/server/app.ts` so they stay rate limited.
- Do not edit `infra/`, `.github/workflows/`, or `package.json` unless the approved OpenSpec change says so.
- Tests live in `tests/`; run the focused file first, for example `npm test -- tests/api.test.ts`, then `npm run typecheck` and `npm run check`.
- For a feature change, follow the active `openspec/changes/<change>/tasks.md` for branch, PR, path ownership, and receipt rules.
