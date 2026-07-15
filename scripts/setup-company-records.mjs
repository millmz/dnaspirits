/**
 * Loads DNA Spirits LLC's company records — the Jan 2025 cap table and the
 * core legal register (formation, A&R operating agreement, NY biennial
 * statement clock). Guarded: only runs when both tables are empty, so records
 * managed in the app are never overwritten. Source: DNA Spirits Cap Table
 * 2025 workbook + executed A&R Operating Agreement (effective 2019-05-01).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Excel serial date → JS Date (workbook uses 1900 date system)
const xl = (serial) => new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
const usd = (dollars) => Math.round(dollars * 100);

// [member, unitType, units, dateSerial|null, round, capitalUSD, notes]
const CAP_TABLE = [
  ["Adam Millman", "VOTING", 3333, null, "Founder", 0, "Founder units"],
  ["Daniel Neeson", "VOTING", 3333, null, "Founder", 0, "Founder units"],
  ["Robert Lang-Assael", "ECONOMIC", 500, 43679, "Seed", 500000, ""],
  ["William J Neeson", "ECONOMIC", 50, 44183, "Seed", 50000, ""],
  ["Robert & Christina Lang-Assael", "ECONOMIC", 300, 44188, "Seed", 300000, ""],
  ["Curragh Capital Partners", "ECONOMIC", 200, 44188, "Seed", 200000, ""],
  ["Michael Lehner", "ECONOMIC", 200, 44204, "Seed", 200000, "$10M pre / $12.43M post"],
  ["Jeff & Michelle Millman", "ECONOMIC", 50, 44209, "Seed", 50000, ""],
  ["Jason Molin", "ECONOMIC", 50, 44249, "Seed", 50000, ""],
  ["Larry Foley", "ECONOMIC", 100, 44256, "Seed", 100000, ""],
  ["Miller Family Ventures", "ECONOMIC", 100, 44312, "Seed", 100000, "$12.5M pre / $14.375M post"],
  ["Angry Wave Spirits", "ECONOMIC", 130, 44319, "Seed", 130000, ""],
  ["Curragh Capital Partners", "ECONOMIC", 50, 44562, "Secondary", 0, "Acquired from TDC Life"],
  ["William J Neeson", "ECONOMIC", 500, 44567, "Seed", 500000, ""],
  ["Clifford Stern", "ECONOMIC", 50, 44573, "Seed", 50000, ""],
  ["Clifford Stern", "ECONOMIC", 50, 44636, "Seed", 50000, ""],
  ["Donohue Trust", "ECONOMIC", 90, 44764, "Seed", 90000, ""],
  ["Donohue Trust", "ECONOMIC", 10, 44764, "Seed", 10000, ""],
  ["Jonathan Serko", "ECONOMIC", 50, 44926, "Seed", 50000, ""],
  ["Miller Family Ventures", "ECONOMIC", 429, 45274, "Secondary", 0, "Acquired from Michael Mills"],
  ["Curragh Capital Partners", "ECONOMIC", 571, 45274, "Secondary", 0, "Acquired from Michael Mills"],
  ["William J Neeson", "ECONOMIC", 240, 45342, "Bridge", 300000, ""],
  ["Jason Molin", "ECONOMIC", 20, 45351, "Bridge", 25000, "$14.5575M post"],
  ["Lara Lerner", "ECONOMIC", 20, 45481, "Bridge", 25000, ""],
  ["Doris Wong Johnson", "ECONOMIC", 100, 45595, "Bridge", 125000, ""],
  ["William J Neeson", "ECONOMIC", 120, 45618, "Bridge", 150000, ""],
  ["Adam Millman & Blake Weingord", "ECONOMIC", 200, 45689, "Bridge", 250000, ""],
  ["Seven Shots, LLC", "ECONOMIC", 800, 45809, "Bridge", 1000000, ""],
];

const LEGAL = [
  {
    type: "DOCUMENT",
    title: "Articles of Organization — DNA Spirits LLC",
    jurisdiction: "New York",
    executed: new Date("2017-09-26T00:00:00Z"),
    notes: "Formed 2017-09-26 with the NY Department of State.",
  },
  {
    type: "DOCUMENT",
    title: "Amended & Restated Operating Agreement (executed)",
    jurisdiction: "New York",
    executed: new Date("2019-05-01T00:00:00Z"),
    notes:
      "Effective 2019-05-01. Voting / Economic / Preferred unit classes; transfer restrictions Arts. XIII–XV; non-compete Art. XXI.",
  },
  {
    type: "DOCUMENT",
    title: "Cap Table — Jan 2025 workbook",
    executed: new Date("2025-01-01T00:00:00Z"),
    notes: "Source workbook for the Cap Table page. Update both together.",
  },
  {
    type: "DEADLINE",
    title: "NY Biennial Statement — DNA Spirits LLC",
    jurisdiction: "New York",
    dueDate: new Date("2027-09-30T00:00:00Z"),
    notes: "Due every two years in the formation anniversary month (September, odd years).",
  },
];

async function main() {
  const [capCount, legalCount] = await Promise.all([
    db.capTableEntry.count(),
    db.legalRecord.count(),
  ]);

  if (capCount === 0) {
    await db.capTableEntry.createMany({
      data: CAP_TABLE.map(([member, unitType, units, serial, round, capital, notes]) => ({
        member,
        unitType,
        units,
        dateAcquired: serial ? xl(serial) : null,
        round,
        capitalCents: usd(capital),
        notes,
      })),
    });
    const total = CAP_TABLE.reduce((a, r) => a + r[2], 0);
    console.log(
      `setup-company: cap table loaded — ${CAP_TABLE.length} entries, ${total.toLocaleString("en-US")} units.`
    );
  } else {
    console.log("setup-company: cap table already has entries — skipping.");
  }

  if (legalCount === 0) {
    await db.legalRecord.createMany({ data: LEGAL });
    console.log(`setup-company: legal register seeded with ${LEGAL.length} records.`);
  } else {
    console.log("setup-company: legal register already has records — skipping.");
  }
}

main()
  .catch((e) => {
    console.error("setup-company: skipped due to error:", e);
  })
  .finally(() => db.$disconnect());
