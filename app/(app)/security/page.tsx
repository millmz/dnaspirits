import { requireUser } from "@/lib/auth";
import { unseal } from "@/lib/crypto";
import { otpauthUrl } from "@/lib/totp";
import { PageHeader, Card, Field, inputCls, btnCls, Badge, Callout } from "@/components/ui";
import { start2fa, cancel2fa, confirm2fa, disable2fa, changeMyPassword, signOutEverywhere } from "./actions";
import { SubmitButton } from "@/components/submit-button";

/** Personal security settings — reachable by every signed-in user. */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireUser();
  const { ok, err } = await searchParams;

  const enrolling = !user.totpEnabled && !!user.totpSecret;
  const secret = enrolling ? unseal(user.totpSecret) : "";
  const secretGrouped = secret.replace(/(.{4})/g, "$1 ").trim();

  return (
    <div>
      <PageHeader
        label="Account"
        title="My Security"
        subtitle="Two-factor authentication, password, and active sessions for your account."
      />

      {ok && <div className="mb-4"><Callout tone="green">{ok}</Callout></div>}
      {err && <div className="mb-4"><Callout tone="amber">{err}</Callout></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Two-factor authentication">
          {user.totpEnabled ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Badge tone="green">2FA is on</Badge>
                <span className="text-sm text-slate/80">
                  A code from your authenticator app is required at every sign-in.
                </span>
              </div>
              <form action={disable2fa} className="flex items-end gap-3">
                <Field label="Current code from your app" className="flex-1">
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    placeholder="123456"
                    className={inputCls}
                  />
                </Field>
                <SubmitButton>Turn off</SubmitButton>
              </form>
            </>
          ) : enrolling ? (
            <div className="space-y-4">
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate/90">
                <li>
                  Open an authenticator app (Google Authenticator, 1Password, Authy…) and add an
                  account with this setup key:
                  <div className="mt-2 rounded-md border border-ink/10 bg-white px-3 py-2 font-mono text-sm tracking-wide">
                    {secretGrouped}
                  </div>
                  <a href={otpauthUrl(user.email, secret)} className="mt-1 inline-block text-xs font-medium text-agave-deep hover:underline">
                    On your phone? Tap here to open it in your authenticator app →
                  </a>
                </li>
                <li>Enter the 6-digit code the app shows to finish:</li>
              </ol>
              <form action={confirm2fa} className="flex items-end gap-3">
                <Field label="6-digit code" className="flex-1">
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                    placeholder="123456"
                    className={inputCls}
                  />
                </Field>
                <SubmitButton>Confirm & turn on</SubmitButton>
              </form>
              <form action={cancel2fa}>
                <button className="px-1 py-1.5 text-xs text-slate/50 transition-colors hover:text-burnt">Cancel setup</button>
              </form>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm leading-relaxed text-slate/90">
                Add a second lock on your account: signing in will require your password{" "}
                <em>and</em> a 6-digit code from your phone. Even a stolen password can't get in
                alone. Strongly recommended for every account on this platform.
              </p>
              <form action={start2fa}>
                <SubmitButton>Set up 2FA</SubmitButton>
              </form>
            </>
          )}
          {user.totpEnabled && (
            <p className="mt-3 text-xs text-slate/70">
              Lost your phone? An admin can reset 2FA for your account from Settings, then you can
              set it up again on a new device.
            </p>
          )}
        </Card>

        <Card title="Change my password">
          <form action={changeMyPassword} className="space-y-3">
            <Field label="Current password">
              <input name="current" type="password" required autoComplete="current-password" className={inputCls} />
            </Field>
            <Field label="New password (12+ characters)">
              <input name="next" type="password" required minLength={12} autoComplete="new-password" className={inputCls} />
            </Field>
            <SubmitButton>Update password</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-slate/70">
            Changing your password signs out every other session on your account.
          </p>
        </Card>

        <Card title="Active sessions">
          <p className="mb-3 text-sm leading-relaxed text-slate/90">
            Left yourself signed in on a shared computer, or worried a session was stolen? This
            immediately invalidates your account's sessions on every device except this one.
          </p>
          <form action={signOutEverywhere}>
            <SubmitButton>Sign out everywhere else</SubmitButton>
          </form>
        </Card>
      </div>
    </div>
  );
}
