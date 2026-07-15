export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function dateStr(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** Parse "$1,234.56" / "1234.56" style input into integer cents. */
export function toCents(input: string | null | undefined): number {
  if (!input) return 0;
  const cleaned = input.replace(/[$,\s]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(val * 100);
}

export function toInt(input: string | null | undefined, fallback = 0): number {
  const val = parseInt((input ?? "").trim(), 10);
  return isNaN(val) ? fallback : val;
}

export function toFloat(input: string | null | undefined, fallback = 0): number {
  const val = parseFloat((input ?? "").replace(/,/g, "").trim());
  return isNaN(val) ? fallback : val;
}

export function toDate(input: string | null | undefined): Date {
  if (!input) return new Date();
  const d = new Date(input);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Current month as YYYY-MM */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}
