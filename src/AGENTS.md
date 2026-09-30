# Application source guide

- `src/shared/contracts.ts` is the contract for client and server; change it first, then storage, API, and client.
- `FeedbackStorage` in `src/server/storage.ts` has in-memory and Azure Table adapters; keep behavior identical in both.
- API errors use the `ApiError` shape and existing codes in `src/server/app.ts`.
- Do not edit `infra/`, `.github/workflows/`, or `package.json` unless the approved OpenSpec change says so.
- Tests live in `tests/`; run the focused file first, for example `npm test -- tests/api.test.ts`, then `npm run check`.
