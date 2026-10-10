"use client";

import { useCallback, useEffect, useState } from "react";

interface Transaction {
  id: number;
  direction: "SENT" | "RECEIVED";
  amount: string;
  counterparty: string;
  reference: string;
  createdAt: string;
}

/**
 * Transaction history.
 *
 * The list has a fixed maximum height and `overflow-y-auto`, so it scrolls
 * internally only once the rows exceed the panel — with a handful of
 * transactions the panel simply grows to fit, which is what the design asked
 * for. Polls every 5 seconds so a transfer appears without a manual reload.
 */
export default function TransactionHistory() {
  const [items, setItems] = useState<Transaction[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/transactions", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.transactions ?? []);
    } catch {
      // Keep the last good list; the next poll will retry.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section className="rounded-xl border border-border">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-medium">Transaction history</h2>
        {items && items.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {items.length}
          </span>
        )}
      </header>

      <div className="max-h-[26rem] overflow-y-auto">
        {items === null ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Send or receive money and it will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((t) => {
              const sent = t.direction === "SENT";
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border ${
                        sent ? "text-muted-foreground" : "text-emerald-600"
                      }`}
                      aria-hidden="true"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {sent ? (
                          <>
                            <path d="M7 17L17 7" />
                            <path d="M9 7h8v8" />
                          </>
                        ) : (
                          <>
                            <path d="M17 7L7 17" />
                            <path d="M15 17H7V9" />
                          </>
                        )}
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {sent ? "Sent to " : "Received from "}
                        <span className="font-medium">@{t.counterparty}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.createdAt
                          ? new Date(t.createdAt).toLocaleString()
                          : ""}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-medium tabular-nums ${
                      sent ? "" : "text-emerald-600"
                    }`}
                  >
                    {sent ? "−" : "+"}${Number(t.amount).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
