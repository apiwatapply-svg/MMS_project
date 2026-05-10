# MMS Dashboard CI Workflow

This project uses GitHub Actions to check the application before merge or deployment.

## CI Steps

1. Checkout source code.
2. Install backend dependencies with `npm ci`.
3. Run backend syntax check with `npm run lint`.
4. Run backend unit tests with `npm test`.
5. Run machine simulator tests with `npm run test:sim`.
6. Run backend smoke test with `npm run smoke`.
7. Install frontend dependencies with `npm ci`.
8. Build the frontend with `npm run build`.

## Why These Steps Matter

- Backend syntax check catches broken JavaScript before runtime.
- Unit tests protect OEE, output, machine status, report, auto NG, and display logic.
- Simulator tests protect target-aware machine simulation rules such as cycle time, planned stop, preventive, QC, and NG caps.
- Smoke test starts the API with machine I/O disabled and verifies `/api/health`.
- Frontend build catches TypeScript and Next.js production build problems.

## Current Frontend Lint Status

Frontend lint is scoped to `src` with:

```bash
npm run lint
```

It is not yet a required CI gate because the existing frontend has many historical lint issues such as `any`, unused variables, and hook dependency warnings. Keep `npm run build` as the required frontend gate first, then clean lint issues page by page before enabling it in CI.

## Local CI Commands

Run these before pushing:

```bash
cd backend
npm run lint
npm test
npm run test:sim
npm run smoke

cd ../fontend
npm run build
```
