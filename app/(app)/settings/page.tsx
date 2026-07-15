import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls } from "@/components/ui";
import { createUser, deleteUser, changeOwnPassword, createWarehouse } from "./actions";

export default async function SettingsPage() {
  const me = await requireAdmin();
  const [users, warehouses] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
  ]);

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
                    <form action={deleteUser}>
                      <input type="hidden" name="id" value={u.id} />
                      <button className="text-xs text-stone-400 hover:text-red-600">Remove</button>
                    </form>
                  )}
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
              <Field label="Temporary password (8+ chars)">
                <input name="password" type="text" required minLength={8} className={inputCls} />
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
              Share the temporary password with them directly and have them change it after signing in.
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
            <Field label="New password (8+ chars)" className="flex-1">
              <input name="password" type="password" required minLength={8} className={inputCls} />
            </Field>
            <button className={btnCls}>Update</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
