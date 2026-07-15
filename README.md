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

## Deploying (Railway / Render / Fly)

The app is a standard Next.js server with a SQLite database file.

1. Set environment variables:
   - `DATABASE_URL` — e.g. `file:/data/denada.db` (point at a **persistent volume**)
   - `AUTH_SECRET` — a long random string (`openssl rand -hex 32`)
2. Attach a persistent volume mounted at `/data` (Railway/Fly both support this).
3. Build command: `npm run build` · Start command: `npm run db:migrate && npm start`
4. Run `npm run db:seed` once to create the first admin user.

Back up the SQLite file regularly (it's a single file — copy it anywhere safe).
If the team grows, the Prisma schema ports to Postgres by changing the
datasource provider and `DATABASE_URL`.

## Tech stack

Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 ·
Prisma 6 + SQLite · JWT session auth (jose + bcryptjs)

## Integration notes

- **QuickBooks** remains the ledger of record; the Accounting pillar gives
  real-time operating numbers. (A QuickBooks Online API sync is a natural next step.)
- **TTB compliance**: production runs + the inventory ledger capture the data
  needed for reporting; a dedicated compliance/report module is a planned pillar.
