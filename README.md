# Tequila De Nada — Operations

Custom operations platform for Tequila De Nada, built around the brand's actual
business model: contract production in Jalisco, ex-works sales to an importer,
and a three-tier US market you monitor through your importer's reports.

Branded to the De Nada Master Playbook — palette, logo, typography, and voice.

## The two worlds

**Supply chain (Mexico) — what you own and manage**

| Page | What it does |
| --- | --- |
| Dry Goods | Glass, labels, stoppers, capsules, shipper boxes, bulk tequila — on-hand counts, unit costs, lead times, reorder flags |
| Purchasing | POs to Mexican suppliers; receiving a PO adds goods to stock |
| Products & BOM | Each SKU's bill of materials — what one bottle/case consumes |
| Production | Runs at the contract distillery by lot; completing a run adds finished goods **and consumes dry goods per the BOM** (blocked if components are short) |
| Finished Goods | Bottled stock you own in Mexico until it sells ex-works |

**Market (US) — what you watch through your importer's reports**

| Page | What it does |
| --- | --- |
| Importer & Distributors | The channel map: importer(s), and distributors by market |
| Ex-Works Sales | Sales to the importer at the distillery door; confirming hands off ownership and creates the receivable |
| Channel Inventory | Importer + per-distributor stock from their reports, with **weeks-of-supply** per SKU (channel stock ÷ depletion velocity) |
| Depletions | Cases sold through to retail — CSV import for the reports your importer sends (Karma / iDig) |

**Plus:** Marketing (social content calendar with idea → drafted → scheduled →
posted, and an influencer/PR pipeline), Finance (real-time operating numbers,
owner expense log, and the bookkeeper's monthly QuickBooks P&L upload), and a
dashboard that surfaces **restock signals** — low weeks-of-supply in the
channel and dry goods below reorder point, with lead times.

## Team roles

- **Admin** — everything, plus Settings (users, warehouses)
- **Member** — full operations
- **Bookkeeper** — Finance only; lands on Accounting, other pages redirect

## Running locally

```bash
npm install
npm run setup   # migrations + seed (admin login, SKUs, default BOMs)
npm run dev     # http://localhost:3000
```

Default login: `admin@denada.com` / `denada123` — **change immediately**.

## CSV formats (flexible column names, case-insensitive)

- **Depletions:** `distributor, sku, period, cases` (+ optional `account, account_type`)
- **Channel stock:** `holder, sku, period, cases` — holder = importer or distributor name
- **QuickBooks P&L:** `period, account, type, amount` — type = income/expense; re-uploading a month replaces it

Unmatched rows are always skipped **and reported**, never silently dropped.
Dedicated one-click parsers for the exact Karma / iDig export formats can be
added once sample files are available.

## Deploying to Render

`render.yaml` Blueprint included: New → Blueprint → select this repo → Apply.
Starter plan (~$7/mo) with a persistent disk for the SQLite database;
`AUTH_SECRET` is auto-generated and migrations + seed run on startup.

## Tech stack

Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 ·
Prisma 6 + SQLite · JWT session auth · Oswald + Libre Caslon (brand-matched type)
