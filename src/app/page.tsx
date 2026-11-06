import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAccountsForUser } from "@/lib/auth-service";
import { isDb2Configured } from "@/lib/db2";
import { getFeed } from "@/lib/feed-service";
import LogoutButton from "@/components/LogoutButton";
import NotificationBell from "@/components/NotificationBell";
import TransactionHistory from "@/components/TransactionHistory";
import DashboardFeedProvider from "@/components/DashboardFeedProvider";
import AccountActions from "@/components/AccountActions";
import { LogoMark } from "@/components/Logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function maskAccountNumber(accountNumber: string) {
  return `•••• ${accountNumber.slice(-4)}`;
}

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const accounts = await getAccountsForUser(session.userId);
  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0);
  const db2Mode = isDb2Configured();

  // The first snapshot is rendered here, so opening the dashboard costs the
  // client no API call at all — the live updates take over from this state.
  const feed = await getFeed(session.userId);

  const primary = accounts[0];
  const totalBalanceString = totalBalance.toFixed(2);

  return (
    <DashboardFeedProvider initial={feed}>
      <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-base font-medium">Redshark Bank</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-medium tracking-tight">
            Welcome back, {session.fullName || session.username}
          </h1>
          {/* <p className="mt-1.5 text-sm text-muted-foreground">
            {db2Mode
              ? "Your credentials were verified with a one-way SHA-256 hash computed on IBM Db2 for z/OS via ICSF."
              : "Your credentials were verified with a one-way SHA-256 hash comparison."}
          </p> */}
        </div>

        {/* Left column: balances and accounts. Right column: history, which
            scrolls internally once it outgrows its max height. */}
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-normal text-muted-foreground">
                  Total balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-medium tracking-tight tabular-nums">
                  {formatCurrency(totalBalance)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Across {accounts.length || 0} account
                  {accounts.length === 1 ? "" : "s"}
                </p>

                <div className="mt-5">
                  <AccountActions
                    balance={totalBalanceString}
                    accountNumber={primary?.accountNumber ?? ""}
                    accountType={primary?.accountType ?? "CHECKING"}
                    username={session.username}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-normal text-muted-foreground">
                  Signed in as
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-medium tracking-tight">
                  {session.username}
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {session.email}
                </p>
              </CardContent>
            </Card>

            <div>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                Your accounts
              </h2>
              {accounts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
                  No accounts yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between rounded-xl border border-border px-5 py-4"
                    >
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          {account.accountType}
                        </p>
                        <p className="mt-1 font-mono text-sm text-muted-foreground">
                          {maskAccountNumber(account.accountNumber)}
                        </p>
                      </div>
                      <p className="text-lg font-medium tabular-nums">
                        {formatCurrency(account.balance)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            <TransactionHistory />
          </div>
        </div>
      </section>
      </main>
    </DashboardFeedProvider>
  );
}
