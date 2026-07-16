import { db } from "./db";
import { seal, unseal } from "./crypto";

/**
 * QuickBooks Online integration (activates when QBO_CLIENT_ID /
 * QBO_CLIENT_SECRET env vars are set). An admin connects once via OAuth;
 * "Sync now" pulls the ProfitAndLoss report summarized by month and replaces
 * FinancialEntry rows for the covered periods — same shape as a file upload,
 * so everything downstream (Accounting, Reports, Annual View) just works.
 */

const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API_BASE = process.env.QBO_SANDBOX
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";

export const qboConfigured = () =>
  Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);

/**
 * The OAuth redirect URI. Derived from the actual request the admin clicked
 * from (via x-forwarded-* on Render) so it always matches the domain in the
 * browser — never localhost. Falls back to an explicit env override, then to
 * APP_URL. The auth request and the token exchange must use the identical
 * value, which they do because both run on the same domain.
 */
export function qboRedirectUri(req?: Request): string {
  if (process.env.QBO_REDIRECT_URI) return process.env.QBO_REDIRECT_URI;
  if (req) {
    const h = req.headers;
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${proto}://${host}/api/qbo/callback`;
  }
  return `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/qbo/callback`;
}

export function qboAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

const basicAuth = () =>
  "Basic " +
  Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
};

async function storeTokens(realmId: string, t: TokenResponse) {
  const data = {
    realmId,
    accessTokenEnc: seal(t.access_token),
    refreshTokenEnc: seal(t.refresh_token),
    accessExpiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000),
    refreshExpiresAt: t.x_refresh_token_expires_in
      ? new Date(Date.now() + t.x_refresh_token_expires_in * 1000)
      : null,
  };
  await db.qboConnection.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

export async function qboExchangeCode(code: string, realmId: string, redirectUri: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`QBO token exchange failed: ${res.status} ${await res.text()}`);
  await storeTokens(realmId, await res.json());
}

export async function qboConnection() {
  return db.qboConnection.findUnique({ where: { id: 1 } });
}

async function accessToken(): Promise<{ token: string; realmId: string }> {
  const conn = await qboConnection();
  if (!conn) throw new Error("QuickBooks is not connected.");
  if (conn.accessExpiresAt > new Date()) {
    return { token: unseal(conn.accessTokenEnc), realmId: conn.realmId };
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: unseal(conn.refreshTokenEnc),
    }),
  });
  if (!res.ok) throw new Error(`QBO token refresh failed: ${res.status} ${await res.text()}`);
  const t: TokenResponse = await res.json();
  await storeTokens(conn.realmId, t);
  return { token: t.access_token, realmId: conn.realmId };
}

// ---------- ProfitAndLoss report → FinancialEntry rows ----------

export type QboPnlRow = {
  period: string;
  account: string;
  kind: "INCOME" | "EXPENSE";
  amountCents: number;
};

type QboCol = { ColTitle?: string; MetaData?: { Name: string; Value: string }[] };
type QboRow = {
  type?: string;
  group?: string;
  Header?: { ColData?: { value?: string }[] };
  ColData?: { value?: string }[];
  Rows?: { Row?: QboRow[] };
};
type QboReport = {
  Columns?: { Column?: QboCol[] };
  Rows?: { Row?: QboRow[] };
};

const INCOME_GROUPS = new Set(["Income", "OtherIncome"]);
const EXPENSE_GROUPS = new Set(["COGS", "Expenses", "OtherExpenses"]);

/** Column periods from the report header ("StartDate" metadata → YYYY-MM). */
function columnPeriods(report: QboReport): (string | null)[] {
  const cols = report.Columns?.Column ?? [];
  return cols.map((c) => {
    const start = c.MetaData?.find((m) => m.Name === "StartDate")?.Value;
    if (start && /^\d{4}-\d{2}/.test(start)) return start.slice(0, 7);
    return null;
  });
}

/** Walks the report's nested row tree, emitting one entry per leaf account × month. */
export function parseQboPnl(report: QboReport): QboPnlRow[] {
  const periods = columnPeriods(report);
  const out: QboPnlRow[] = [];

  const walk = (rows: QboRow[] | undefined, kind: "INCOME" | "EXPENSE" | null) => {
    for (const row of rows ?? []) {
      let sectionKind = kind;
      if (row.group && INCOME_GROUPS.has(row.group)) sectionKind = "INCOME";
      else if (row.group && EXPENSE_GROUPS.has(row.group)) sectionKind = "EXPENSE";

      if (row.Rows?.Row) {
        walk(row.Rows.Row, sectionKind);
        continue;
      }
      if (row.type !== "Data" || !sectionKind || !row.ColData) continue;
      const account = row.ColData[0]?.value?.trim();
      if (!account) continue;
      for (let c = 1; c < row.ColData.length; c++) {
        const period = periods[c];
        if (!period) continue;
        const amount = parseFloat(row.ColData[c]?.value ?? "");
        if (isNaN(amount) || amount === 0) continue;
        out.push({ period, account, kind: sectionKind, amountCents: Math.round(amount * 100) });
      }
    }
  };
  walk(report.Rows?.Row, null);
  return out;
}

/** Pulls the P&L by month for a year and replaces those periods' entries. */
export async function qboSyncYear(year: number): Promise<{ rows: number; periods: number }> {
  const { token, realmId } = await accessToken();
  const params = new URLSearchParams({
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    summarize_column_by: "Month",
    accounting_method: "Accrual",
    minorversion: "70",
  });
  const res = await fetch(
    `${API_BASE}/v3/company/${realmId}/reports/ProfitAndLoss?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`QBO report fetch failed: ${res.status} ${await res.text()}`);
  const rows = parseQboPnl(await res.json());

  const periods = [...new Set(rows.map((r) => r.period))];
  if (rows.length > 0) {
    await db.$transaction([
      db.financialEntry.deleteMany({ where: { period: { in: periods } } }),
      db.financialEntry.createMany({ data: rows }),
      db.qboConnection.update({ where: { id: 1 }, data: { lastSyncAt: new Date() } }),
    ]);
  }
  return { rows: rows.length, periods: periods.length };
}
