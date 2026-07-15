/**
 * Loads DNA Spirits' historical annual P&Ls (2021–2025) from the accountant's
 * year-end statements (accrual basis). Stored at summary level with period
 * "YYYY-FY" so they feed the annual rollup without polluting monthly trends —
 * the source PDFs remain the statements of record.
 *
 * Each year is verified against the statement's net income before loading,
 * and only loads if that year has no entries yet (monthly or FY), so a later
 * monthly backfill of a year wins over the annual summary.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const usd = (d) => Math.round(d * 100);

// [account, kind, amount USD] per year — from the executed P&L PDFs
const YEARS = {
  2021: {
    netIncome: -492747.56,
    lines: [
      ["Sales of Product Income", "INCOME", 361006.24],
      ["Other Income — Reimbursement", "INCOME", 2730.0],
      ["Cost of Goods Sold", "EXPENSE", 222280.36],
      ["Operating Expenses", "EXPENSE", 632149.46],
      ["Other Expenses", "EXPENSE", 2053.98],
    ],
  },
  2022: {
    netIncome: -782621.59,
    lines: [
      ["Sales of Product Income", "INCOME", 347527.04],
      ["Other Income — Reimbursement", "INCOME", 4898.51],
      ["Cost of Goods Sold", "EXPENSE", 198696.7],
      ["Operating Expenses", "EXPENSE", 935605.44],
      ["Other Expenses", "EXPENSE", 745.0],
    ],
  },
  2023: {
    netIncome: -336591.35, // revised statement
    lines: [
      ["Sales of Product Income", "INCOME", 335670.33],
      ["Other Income — Reimbursement", "INCOME", 145.0],
      ["Cost of Goods Sold", "EXPENSE", 72623.46],
      ["Operating Expenses", "EXPENSE", 599783.22],
    ],
  },
  2024: {
    netIncome: -649458.82,
    lines: [
      ["Sales of Product Income", "INCOME", 312405.35],
      ["Other Income — Reimbursement", "INCOME", 382.0],
      ["Cost of Goods Sold", "EXPENSE", 152736.81],
      ["Operating Expenses", "EXPENSE", 808989.26],
      ["Other Expenses", "EXPENSE", 520.1],
    ],
  },
  2025: {
    netIncome: -451659.33,
    lines: [
      ["Sales", "INCOME", 76200.0],
      ["Sales of Product Income", "INCOME", 448569.79],
      ["Cost of Goods Sold", "EXPENSE", 163444.29],
      ["Operating Expenses", "EXPENSE", 811795.73],
      ["Other Expenses", "EXPENSE", 1189.1],
    ],
  },
};

async function main() {
  for (const [year, data] of Object.entries(YEARS)) {
    const computed = data.lines.reduce(
      (a, [, kind, amt]) => a + (kind === "INCOME" ? amt : -amt),
      0
    );
    if (Math.abs(computed - data.netIncome) > 0.01) {
      console.error(
        `historical-financials: ${year} lines net to ${computed.toFixed(2)}, statement says ${data.netIncome} — skipping this year.`
      );
      continue;
    }
    const existing = await db.financialEntry.count({
      where: { period: { startsWith: `${year}-` } },
    });
    if (existing > 0) {
      console.log(`historical-financials: ${year} already has entries — skipping.`);
      continue;
    }
    await db.financialEntry.createMany({
      data: data.lines.map(([account, kind, amt]) => ({
        period: `${year}-FY`,
        account,
        kind,
        amountCents: usd(amt),
      })),
    });
    console.log(
      `historical-financials: ${year} loaded — net $${data.netIncome.toLocaleString("en-US")}.`
    );
  }
}

main()
  .catch((e) => {
    console.error("historical-financials: skipped due to error:", e);
  })
  .finally(() => db.$disconnect());
