# Deployment

How production runs and how to ship a change. The two apps are deployed
separately:

- **API** (`apps/api`) runs on our own server as a systemd service. Deploys are
  manual: there is no CI deploy, someone runs the steps below on the server.
- **Web** (`apps/web`) runs on **Vercel**.

> **To fill in:** the values in `<angle brackets>` (server, folder, service
> name, settings file, Vercel project, public API address) are not in the repo
> yet. Ask the team, or read them on the server with `systemctl cat <service>`
> and in the Vercel dashboard, and replace them here.

## How production runs

```
browser ──https──▶ Vercel: web (Next.js, apps/web)
                     │  server-side requests with the user's session
                     ▼
              https://<api domain>/api
                     │
          our server: nginx ──▶ api (NestJS, apps/api, 127.0.0.1:4000)
                                  ├──▶ Supabase PostgreSQL (eu-central-1)
                                  └──▶ Salesdoc API (sync)
```

The web app calls the API from Vercel's servers (server components and server
actions in `apps/web/src/lib/api.ts`), not from the browser. So the API must be
reachable from the internet through nginx, while the Node process itself
listens only on `127.0.0.1`.

| | |
|---|---|
| API server | `<server host>` (shared server, behind nginx) |
| API public address | `https://<api domain>/api` |
| Code on the server | `<path to the checkout, e.g. /srv/whitepapers-crm>` |
| API service | `<api-service>` (systemd) |
| API settings | `<path under /etc/, e.g. /etc/whitepapers-crm/api.env>` |
| Web | Vercel project `<vercel project>`, root directory `apps/web` |
| Database | Supabase project `distribution-finance` (eu-central-1), session pooler |

The API runs as a **systemd service**. There is **no `.env` in the production
folder**: the unit loads its settings with `EnvironmentFile=` from a file
under `/etc/`. The apps read plain environment variables, so this needs no code;
a `.env` file is only a convenience for local development.

To see how a service is started and which settings file it loads:

```bash
systemctl cat <api-service>      # ExecStart=…, EnvironmentFile=/etc/…
systemctl status <api-service>
journalctl -u <api-service> -n 100 --no-pager   # recent logs
```

### Settings

API (`<api settings file>`):

| Variable | Production value |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** URL (port 5432) |
| `PORT` | `4000` |
| `HOST` | `127.0.0.1` — only nginx may reach the API |
| `WEB_ORIGIN` | the site's public URL on Vercel (CORS) |
| `SYNC_SCHEDULE` | `on` — the scheduled Salesdoc sync |
| `SALESDOC_CREDENTIALS_FILE` | optional; default `apps/api/data/salesdoc.json` |

Web (Vercel → Project Settings → Environment Variables):

| Variable | Production value |
|---|---|
| `API_URL` | `https://<api domain>/api` |

A new API variable goes into the file under `/etc/`, then the service is
restarted. A new web variable is added in Vercel, then the web app is
redeployed (Vercel applies variables only to new deployments).
Never commit real values; `apps/api/.env.example` lists the names.

## Shipping a change

**Order: API first, then web.** If the web change calls a new or changed API
endpoint and the web goes live first, those pages fail until the API catches
up. Keep API changes backward compatible (add fields, don't remove them), so the
old web keeps working with the new API in between.

> Check in Vercel whether the project deploys **automatically** when `main`
> changes (Settings → Git). If it does, merging into `main` ships the web at
> once: deploy the API from the branch first, or merge only API-compatible
> changes. Branches and pull requests usually get **preview** deployments,
> which do not affect production.

### Before

The change is reviewed and the tests pass (`npm test`, or
`npm run test:remote -w @df/api` on a remote test database, see the README).
What goes live must end up in `main`, or `main` stops matching production.

### API (our server)

1. **Get the code** on the server:

   ```bash
   cd <path to the checkout>
   git fetch && git checkout main && git pull --ff-only
   ```

2. **Install and build** the API (`npm ci` also generates the Prisma client):

   ```bash
   npm ci
   npm run build -w @df/api      # the web is built by Vercel, not here
   ```

3. **Migrate the database**, only if the change adds files under
   `apps/api/prisma/migrations/`. The settings live in `/etc/`, so load them
   into this shell first:

   ```bash
   cd apps/api
   set -a; . <api settings file>; set +a
   npx prisma migrate deploy     # never `migrate dev` in production
   cd ../..
   ```

   Migrations need the session pooler (port 5432). The transaction pooler
   (6543, `pgbouncer=true`) cannot run them.

4. **Restart** the API:

   ```bash
   sudo systemctl restart <api-service>
   ```

5. **Check:**

   ```bash
   curl -s http://127.0.0.1:4000/api/health      # {"ok":true,"database":"up"}
   curl -s https://<api domain>/api/health        # the same, through nginx
   journalctl -u <api-service> -n 50 --no-pager  # no errors on start
   ```

### Web (Vercel)

1. **Deploy:** merge into `main` if Vercel deploys it automatically, or start
   the deployment in the Vercel dashboard (Deployments → Redeploy, or promote
   a preview deployment to production).
2. **Check:** the deployment is *Ready* in Vercel, then log in on the site and
   open the pages the change touched. If pages show "API unavailable", check
   `API_URL` in Vercel and the API health address above.

### Rolling back

API, on the server:

```bash
git checkout <previous commit>
npm ci && npm run build -w @df/api
sudo systemctl restart <api-service>
```

Web: in Vercel → Deployments, open the previous production deployment and
choose **Promote to Production** (instant, no rebuild).

A migration is not undone by this. If a release added one, the old code must
still work with the new schema, or the migration has to be reverted by hand.

## Feature notes

What each release needs beyond the steps above. Add a line per release.

### Склад by category, financial view (FIFO) — `feat/warehouse-finance`, Nov 2026

- **Migrations:** none. **New settings:** none, in either the API or Vercel.
- Both apps changed: deploy the API, then the web. The new web needs the new
  API (it reads the stock valuation fields); the old web works with the new
  API.
- Pages: `/warehouse` («Общее состояние склада») and
  `/warehouse?view=finance` («Финансовое состояние склада»).
- Check after deploy:
  - Finance view shows sums; a `*` means units with no receipt price in our
    data (stock older than the receipts we hold).
  - **Артикул** is read from the Salesdoc product (`article`, `artikul` or
    `sku`). Empty for every product means Salesdoc names the field differently.
  - **Новые заявки** counts orders with Salesdoc status 1 (New), including
    products the warehouse has none of (shown with negative «доступно»).
- How the sums are worked out: `apps/api/src/warehouse/fifo.ts`.

## Not for production

- `DATABASE_URL_TEST` must point at a separate `*_test` database: the test suite
  empties every table it touches.
- To add a user who can log in, run `npm run user:add -w @df/api` with the
  production settings loaded (API step 3); it asks for login, name and password.
