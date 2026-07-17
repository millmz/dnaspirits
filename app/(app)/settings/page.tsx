import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, dateStr } from "@/lib/format";
import { listBackups } from "@/lib/backup";
import { offsiteConfigured, lastOffsiteStatus, diskUsage } from "@/lib/offsite";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createUser, deleteUser, resetUserPassword, changeOwnPassword, createWarehouse, backupNow } from "./actions";

export default async function SettingsPage() {
  const me = await requireAdmin();
  const [users, warehouses] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
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
          <Table headers={["Name", "Email", "Role", ""]}>
            {users.map((u) => (
              <tr key={u.id}>
                <Td>{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{u.role === "ADMIN" ? <Badge tone="green">Admin</Badge> : <Badge>Member</Badge>}</Td>
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
                      <form action={deleteUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <button className="text-left text-xs text-stone-400 hover:text-red-600">Remove</button>
                      </form>
                    </div>
                  )}
                  {u.mustChangePassword && <Badge tone="amber">Temp password</Badge>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Invite team member">
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
            <button className={btnCls}>Add user</button>
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
            <button className={btnCls}>Add</button>
          </form>
        </Card>

        <Card title="Change my password">
          <form action={changeOwnPassword} className="flex items-end gap-3">
            <Field label="New password (12+ chars)" className="flex-1">
              <input name="password" type="password" required minLength={12} className={inputCls} />
            </Field>
            <button className={btnCls}>Update</button>
          </form>
          <p className="mt-2 text-xs text-slate/70">
            Changing your password signs out every other session on your account.
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
            <button className={btnCls}>Back up now</button>
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
