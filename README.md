# distribution-finance

Finance for a distribution business, built on data pulled from Salesdoc
(Sales Doctor).

| App | Stack | Port |
|---|---|---|
| `apps/web` | Next.js 16, TypeScript, Tailwind 4, shadcn/ui | 3000 |
| `apps/api` | NestJS 12, Prisma 7, PostgreSQL | 4000 (prefix `/api`) |

## Run locally

```bash
npm install                 # also generates the Prisma client
npm run db:migrate          # apply migrations to DATABASE_URL
npm run dev:api             # http://localhost:4000/api/health
npm run dev:web             # http://localhost:3000
```

- `apps/api/.env` — `DATABASE_URL`, `PORT`, `WEB_ORIGIN` (see `.env.example`).
- `apps/api/data/salesdoc.json` — Salesdoc credentials (copy
  `salesdoc.example.json`). Gitignored; re-read on change, no restart needed.
- `apps/web` reads `API_URL` (default `http://localhost:4000/api`).

## Endpoints

- `GET /api/health` — API and database.
- `GET /api/salesdoc/status` — credentials present and login works.

## Tests

```bash
npm test                               # api unit tests
npm run test:e2e -w @df/api            # api e2e, needs the database
```

Salesdoc API notes: [docs/salesdoc-api.md](docs/salesdoc-api.md).
