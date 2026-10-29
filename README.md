# FleetFlow

Delivery and fleet management for businesses that run their own drivers — built for Bangladesh (BDT pricing, Asia/Dhaka by default).

- **Company app** (`/`) — admins create, import and dispatch deliveries, manage drivers, vehicles and staff, and see reports.
- **Driver portal** (same app, driver accounts) — job list, status updates, proof of delivery (signature / photo).
- **Customer tracking** (`/?track=<token>`) — public, no login.
- **Platform console** (`/platform`) — FleetFlow staff manage companies, users, plans and billing.

Stack: Next.js 16 (App Router) · React 19 · Prisma 6 · PostgreSQL (Neon) · Tailwind 4 / shadcn/ui · Resend (email) · Cloudinary (proof files) · Sentry (errors).

## Local setup

Requires Node ≥ 20.9.

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then fill in DATABASE_URL and DIRECT_URL at least
npm run db:migrate          # apply migrations (creates tables + the plan catalog)
node scripts/create-super-admin.mjs --email you@example.com --name "Your Name"
npm run dev                 # http://localhost:3000
```

Sign up a company from the login page (self-service sign-up is on unless `ALLOW_SIGNUP="false"`), or sign in to `/platform` with the super admin.

See [.env.example](.env.example) for every variable. Without the Cloudinary variables, proof files are kept in `storage/pod` (fine for development). Without a Sentry DSN, error monitoring is off.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run typecheck` · `lint` · `test` | TypeScript, ESLint, unit tests (Vitest) |
| `npm run db:migrate` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a new migration from schema changes (development DB only) |
| `npm run db:status` | Show which migrations a database has |
| `node scripts/create-super-admin.mjs` | The only way to create a platform admin |
| `node scripts/set-plan.mjs` | Change a company's plan from the command line (`--dry-run` supported) |
| `node scripts/migrate-pod-to-cloudinary.mjs` | Move proof files from `storage/pod` to Cloudinary (`--dry-run` supported) |

## Database migrations

The schema is managed with **Prisma Migrate**. `prisma/migrations/0_init` is the baseline (the schema as of 2026-10-28, plus the launch plan catalog); every change after that is a new migration. `prisma/manual-migrations/` is history from before the baseline — don't run it.

To change the schema:

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate:dev -- --create-only --name <change>` against a **development** database, then read the generated SQL.
3. Prisma 6 can't express the partial index `Plan_single_default` (only one default plan). If the generated SQL drops it, delete that line. `tests/unit/migrations.test.ts` fails on any unreviewed `DROP`, `DELETE` or `TRUNCATE`.
4. Commit the migration. Apply it to production with `npm run db:migrate` (uses `DIRECT_URL`).

Never use `prisma db push` or `prisma migrate reset` against the shared database. CI applies all migrations to an empty Postgres and fails if they don't produce exactly `schema.prisma`.

## Testing

- **Unit:** `npm test`.
- **End-to-end:** `tests/e2e/*.e2e.mjs` are HTTP scripts that **mutate data**. Run them only against a server backed by a disposable database, e.g. a separate schema (`?schema=fleetflow_e2e`):
  ```bash
  DATABASE_URL="…?schema=fleetflow_e2e" DIRECT_URL="…?schema=fleetflow_e2e" npx prisma migrate deploy
  DATABASE_URL="…?schema=fleetflow_e2e" ALLOW_DESTRUCTIVE_SEED=1 npx tsx prisma/seed.ts   # demo data
  DATABASE_URL="…?schema=fleetflow_e2e" APP_URL=http://localhost:3002 npx next start -p 3002
  E2E_BASE_URL=http://localhost:3002 node tests/e2e/core.e2e.mjs
  ```
  The seed wipes every table, so it refuses to run unless the database is local or uses a non-public schema.

## Deploying (Vercel)

1. Import the GitHub repo in Vercel (framework: Next.js; defaults are fine).
2. Set environment variables for **Production** (and Preview if you use it):
   `DATABASE_URL`, `DIRECT_URL`, `APP_URL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
   `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `ALLOW_SIGNUP`.
   Keep `NEXT_PUBLIC_DEMO_MODE` unset.
3. Apply migrations **before** deploying code that needs them: `npm run db:migrate` from your machine (or a CI job) with the production `DIRECT_URL`. Deploys don't run migrations, so a preview build can never change the production schema.
4. After deploying, check `GET /api/` returns `200` with `"database":"ok"` and `"storage":"cloudinary"`, and point an uptime monitor at it.

Notes:
- Proof photos are downsized in the browser and capped at 4 MB per upload, below Vercel's request-size limit. They are stored as **private** Cloudinary assets and served only through the authenticated `/api/pod/[id]` route.
- Login, sign-up and password-change throttling is stored in Postgres (`RateLimit` table), so it holds across serverless instances.
- Self-hosting instead: run `npm run build && npm start` behind one reverse proxy (set `TRUSTED_PROXY_HOPS` if there are more), and use Cloudinary or keep `storage/pod` on a backed-up disk.

## Operations

- **Health:** `GET /api/` → `{ status, database, dbLatencyMs, storage }`; `503` when the database is unreachable.
- **Errors:** Sentry (org `jubu`), server and browser. Request bodies, cookies, query strings, database parameters and local variables are never sent (`src/lib/sentry-options.ts`).
- **Billing:** manual — see [docs/BILLING.md](docs/BILLING.md).
- **Email:** outbox with manual retry — see [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md).
