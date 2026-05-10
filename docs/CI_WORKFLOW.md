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
8. Run frontend lint with `npm run lint`.
9. Build the frontend with `npm run build`.

## Why These Steps Matter

- Backend syntax check catches broken JavaScript before runtime.
- Unit tests protect OEE, output, machine status, report, auto NG, and display logic.
- Simulator tests protect target-aware machine simulation rules such as cycle time, planned stop, preventive, QC, and NG caps.
- Smoke test starts the API with machine I/O disabled and verifies `/api/health`.
- Frontend lint catches Next.js and React code quality issues inside `src`.
- Frontend build catches TypeScript and Next.js production build problems.

## Frontend Lint Policy

Frontend lint is scoped to `src` with:

```bash
npm run lint
```

It is now a required CI gate. The project still contains historical frontend debt, so the current ESLint policy disables rules that require larger refactors first, such as `any`, unused variables, and hook dependency warnings. Keep this gate enabled, then clean and re-enable stricter rules page by page.

## Local CI Commands

Run these before pushing. This is the same check order as GitHub Actions.

```bash
cd C:/Users/FDB-MM-024/Documents/My_Project/Apply_Job/Portfolio/MMS_project/backend
npm ci
npm run lint
npm test
npm run test:sim
npm run smoke

cd ../fontend
npm ci
npm run lint
npm run build
```

## What To Run Manually

If you want to do CI by yourself, run these commands in order:

1. `cd C:/Users/FDB-MM-024/Documents/My_Project/Apply_Job/Portfolio/MMS_project/backend`
2. `npm ci`
3. `npm run lint`
4. `npm test`
5. `npm run test:sim`
6. `npm run smoke`
7. `cd ../fontend`
8. `npm ci`
9. `npm run lint`
10. `npm run build`

The project is ready to push when all commands finish without errors.

## Command Meaning

- `npm ci`: Install dependencies exactly from `package-lock.json`.
- `npm run lint` in backend: Check backend JavaScript syntax.
- `npm test`: Run backend unit tests.
- `npm run test:sim`: Run Python simulator unit tests through the cross-platform Node wrapper.
- `npm run smoke`: Start backend with machine I/O disabled and verify `/api/health`.
- `npm run lint` in frontend: Run ESLint for frontend source files.
- `npm run build`: Build the Next.js frontend for production.
