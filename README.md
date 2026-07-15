# Denada Tequila — Operations

Custom business management system for Denada Tequila. One place for the whole
operation, organized into pillars:

| Pillar | What it does |
| --- | --- |
| **Dashboard** | Inventory on hand, monthly/YTD depletions, open receivables, recent activity |
| **Supply chain** | Products/SKUs, production runs with lot codes, multi-warehouse inventory ledger |
| **Distribution** | Distributor accounts, shipments (draw down inventory), depletion tracking with CSV import |
| **Accounting** | Expenses by category, receivables, real-time YTD P&L approximation |
| **Marketing** | Campaigns with budget-vs-spend, events/tastings log |
| **Settings** | Team logins (admin/member roles), warehouses |

## How the core loop works

1. **Products** define your SKUs, bottles per case, case COGS, and wholesale case price.
2. **Production runs** track each batch (lot code, agave source, distillery/NOM, cost).
   Completing a run posts the bottles into a warehouse.
3. **Shipments** record sales to distributors. Marking a shipment *shipped* checks stock
   and draws down inventory; it also becomes an invoice you can mark paid.
4. **Depletions** are the cases your distributors sell through to retail — import their
   monthly reports as CSV or enter manually. This is your true growth number.
5. Inventory is a **movement ledger** (production in, shipments out, transfers,
   adjustments, samples), so stock on hand is always auditable.

## Running locally

```bash
npm install
npm run setup   # applies DB migrations + seeds admin user
npm run dev     # http://localhost:3000
```

Default login: `admin@denada.com` / `denada123` — **change this immediately**
(Settings → Change my password).

## Depletion CSV format

Flexible column names, matched case-insensitively:

```csv
distributor,sku,period,cases,account,account_type
Lone Star Distributing,DN-BLANCO-750,2026-06,4,Total Wine Austin,off premise
```

- `distributor` must match a distributor name in the system; `sku` a product SKU (or product name).
- `period` accepts `2026-06`, `2026/06/15`, or any parseable date (normalized to month).
- `account` and `account_type` (on/off premise) are optional.
- Unmatched rows are skipped and reported — nothing is silently dropped.

## Deploying to Render (recommended)

The repo ships with a `render.yaml` Blueprint that configures everything:
build, start (migrations + seed run automatically), a 1 GB persistent disk
at `/data` for the SQLite database, and an auto-generated `AUTH_SECRET`.

1. Sign in at [render.com](https://render.com) with your GitHub account.
2. Click **New → Blueprint**, select the `dnaspirits` repository, and click **Apply**.
3. Wait for the first build (~5 minutes), then open the service URL.
4. Log in with the default admin credentials and change the password immediately.

Costs: Starter plan (~$7/mo) — required because the database disk needs a
persistent volume, which the free tier doesn't support.

Back up the SQLite file regularly (Render → service → Disks → snapshots, or
copy `/data/denada.db` via the service shell). If the team grows, the Prisma
schema ports to Postgres by changing the datasource provider and `DATABASE_URL`.

### Other hosts (Railway / Fly)

Standard Next.js server + SQLite file: mount a persistent volume, set
`DATABASE_URL=file:/data/denada.db` and a random `AUTH_SECRET`, build with
`npm install --include=dev && npm run build`, start with `npm run deploy:start`.

## Tech stack

Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 ·
Prisma 6 + SQLite · JWT session auth (jose + bcryptjs)

## Integration notes

- **QuickBooks** remains the ledger of record; the Accounting pillar gives
  real-time operating numbers. (A QuickBooks Online API sync is a natural next step.)
- **TTB compliance**: production runs + the inventory ledger capture the data
  needed for reporting; a dedicated compliance/report module is a planned pillar.
