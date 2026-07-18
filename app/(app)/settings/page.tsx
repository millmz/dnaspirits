import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, dateStr } from "@/lib/format";
import { listBackups } from "@/lib/backup";
import { offsiteConfigured, lastOffsiteStatus, diskUsage } from "@/lib/offsite";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { emailEnabled, emailRecipients } from "@/lib/email";
import { createUser, deleteUser, resetUserPassword, resetUser2fa, forceSignOut, createWarehouse, backupNow, sendTestAlertEmail } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ mail?: string }>;
}) {
  const me = await requireAdmin();
  const { mail } = await searchParams;
  const [users, warehouses, loginEvents] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.loginEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const backups = listBackups();
  const offsiteOn = offsiteConfigured();
  const offsite = lastOffsiteStatus();
  const disk = diskUsage();

  return (
    <div>
      <PageHeader title="Settings" subtitle="Team, warehouses, and account" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Team">
          <Table headers={["Name", "Email", "Role", "2FA", ""]}>
            {users.map((u) => (
              <tr key={u.id}>
                <Td>{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{u.role === "ADMIN" ? <Badge tone="green">Admin</Badge> : <Badge>Member</Badge>}</Td>
                <Td>{u.totpEnabled ? <Badge tone="green">On</Badge> : <Badge tone="amber">Off</Badge>}</Td>
                <Td>
                  {u.id !== me.id && (
                    <div className="flex flex-col gap-1">
                      <form action={resetUserPassword} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={u.id} />
                        <input
                          name="password"
                          type="text"
                          minLength={12}
                          placeholder="New temp password"
                          className="w-36 rounded border border-ink/15 bg-white px-1.5 py-0.5 text-xs"
                        />
                        <button className="text-xs font-medium text-agave-deep hover:underline">Reset</button>
                      </form>
                      <div className="flex items-center gap-2">
                        {u.totpEnabled && (
                          <form action={resetUser2fa}>
                            <input type="hidden" name="id" value={u.id} />
                            <button className="text-xs text-stone-400 hover:text-amber-700">Reset 2FA</button>
                          </form>
                        )}
                        <form action={forceSignOut}>
                          <input type="hidden" name="id" value={u.id} />
                          <button className="text-xs text-stone-400 hover:text-amber-700">Sign out</button>
                        </form>
                        <form action={deleteUser}>
                          <input type="hidden" name="id" value={u.id} />
                          <button className="px-1 py-1.5 text-xs text-slate/50 transition-colors hover:text-burnt">Remove</button>
                        </form>
                      </div>
                    </div>
                  )}
                  {u.mustChangePassword && <Badge tone="amber">Temp password</Badge>}
                </Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-slate/70">
            "Reset 2FA" is the recovery path for a lost phone; "Sign out" kills every session on
            that account. Ask everyone to turn on 2FA under My Security.
          </p>
        </Card>

        <Card title="Invite team member" collapsible>
          <form action={createUser} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <input name="name" required className={inputCls} />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Temporary password (12+ chars)">
                <input name="password" type="text" required minLength={12} className={inputCls} />
              </Field>
              <Field label="Role">
                <select name="role" className={inputCls}>
                  <option value="MEMBER">Member (full operations)</option>
                  <option value="BOOKKEEPER">Bookkeeper (finance only)</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </Field>
            </div>
            <SubmitButton>Add user</SubmitButton>
            <p className="text-xs text-stone-400">
              Share the temporary password with them directly — they'll be required to choose their own the first time they sign in.
            </p>
          </form>
        </Card>

        <Card title="Warehouses">
          <Table headers={["Name", "Location"]}>
            {warehouses.map((w) => (
              <tr key={w.id}>
                <Td>{w.name}</Td>
                <Td>{w.location || "—"}</Td>
              </tr>
            ))}
          </Table>
          <form action={createWarehouse} className="mt-4 flex items-end gap-3">
            <Field label="Name" className="flex-1">
              <input name="name" required placeholder="TX Bonded Warehouse" className={inputCls} />
            </Field>
            <Field label="Location" className="flex-1">
              <input name="location" placeholder="Dallas, TX" className={inputCls} />
            </Field>
            <SubmitButton>Add</SubmitButton>
          </form>
        </Card>

        <Card title="Email alerts & weekly digest">
          {mail && (
            <div className={`mb-3 rounded-md px-3 py-2 text-sm ${mail === "sent" ? "bg-agave/10 text-agave-deep" : "bg-burnt/10 text-burnt"}`}>
              {mail === "sent" ? "Test digest sent — check your inbox." : `Send failed: ${mail}`}
            </div>
          )}
          {emailEnabled() ? (
            <>
              <p className="text-sm text-ink/85">
                <span className="font-medium text-agave-deep">On.</span> Daily "needs attention" email
                (only when something's wrong) and a Monday digest go to{" "}
                <span className="font-mono text-xs">{emailRecipients().join(", ")}</span>.
              </p>
              <form action={sendTestAlertEmail} className="mt-3">
                <SubmitButton>Send test digest now</SubmitButton>
              </form>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-ink/85">
              <span className="font-medium text-burnt">Off.</span> To get alerts (publish failures,
              overdue invoices, low stock, legal deadlines) and a Monday digest by email: create a free
              account at <span className="font-medium">resend.com</span>, then set{" "}
              <span className="font-mono text-xs">RESEND_API_KEY</span> and{" "}
              <span className="font-mono text-xs">ALERT_EMAIL_TO</span> (comma-separated recipients) in
              Render.
            </p>
          )}
        </Card>

        <Card title="Sign-in activity">
          {loginEvents.length === 0 ? (
            <EmptyState>No sign-in attempts recorded yet.</EmptyState>
          ) : (
            <Table headers={["When (UTC)", "Account", "Step", "Result", "IP"]}>
              {loginEvents.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <span className="whitespace-nowrap text-xs">
                      {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  </Td>
                  <Td>{e.email}</Td>
                  <Td>{e.kind === "TWO_FACTOR" ? "2FA code" : "Password"}</Td>
                  <Td>{e.ok ? <Badge tone="green">OK</Badge> : <Badge tone="red">Failed</Badge>}</Td>
                  <Td><span className="font-mono text-xs">{e.ip || "—"}</span></Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-xs text-slate/70">
            Every password and 2FA attempt, kept for 90 days. A run of failures against an account
            you don't recognize means someone is guessing at your door — the rate limiter slows
            them down, but that's the cue to make sure 2FA is on. Your own password and 2FA
            settings live under <span className="font-medium">My Security</span>.
          </p>
        </Card>

        <Card title="Database backups">
          {backups.length === 0 ? (
            <EmptyState>
              No snapshots yet — one is taken automatically shortly after each deploy and every 24 hours.
            </EmptyState>
          ) : (
            <Table headers={["Snapshot", "Taken", "Size", ""]} align={["left", "left", "right", "left"]}>
              {backups.slice(0, 8).map((b) => (
                <tr key={b.name}>
                  <Td><span className="font-mono text-xs">{b.name}</span></Td>
                  <Td>{dateStr(b.mtime)}</Td>
                  <Td right>{num(Math.round(b.bytes / 1024))} KB</Td>
                  <Td>
                    <a
                      href={`/settings/backups?file=${encodeURIComponent(b.name)}`}
                      className="text-xs font-medium text-agave-deep hover:underline"
                    >
                      Download
                    </a>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <form action={backupNow} className="mt-3">
            <SubmitButton>Back up now</SubmitButton>
          </form>
          <div className="mt-3 rounded-md border border-ink/10 bg-white/60 px-3 py-2 text-xs leading-relaxed">
            {offsiteOn ? (
              <>
                <span className="font-medium text-agave-deep">Offsite backups: on.</span>{" "}
                {offsite
                  ? `Last run ${offsite.at.slice(0, 16).replace("T", " ")} UTC — snapshot ${offsite.snapshot ? "uploaded" : "FAILED"}, ${offsite.mediaUploaded} new media file(s) uploaded${offsite.errors.length ? ` · ${offsite.errors.length} error(s), see logs` : ""}.`
                  : "First nightly run hasn't happened yet."}
              </>
            ) : (
              <>
                <span className="font-medium text-burnt">Offsite backups: OFF.</span> The database, its
                snapshots and all post media live on one disk — set the{" "}
                <span className="font-mono">OFFSITE_S3_*</span> env vars in Render (any S3-compatible
                bucket: Cloudflare R2, AWS S3, Backblaze) to copy them offsite nightly.
              </>
            )}
            {disk && (
              <div className={`mt-1 ${disk.usedPct >= 85 ? "font-medium text-burnt" : "text-slate/70"}`}>
                Data disk: {disk.usedPct}% used ({Math.round(disk.freeBytes / 1024 / 1024)} MB free
                of {Math.round(disk.totalBytes / 1024 / 1024)} MB)
                {disk.usedPct >= 85 && " — clean up old media or resize the disk soon."}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate/70">
            Snapshots are consistent copies of the live database, rotated automatically (14 kept on disk).
          </p>
        </Card>
      </div>
    </div>
  );
}
