"use client";

import { useState } from "react";
import { useDashboardFeed } from "@/components/DashboardFeedProvider";

/**
 * Transaction history.
 *
 * Every row now carries the two identifiers recorded by the ledger:
 *   - TRX_ID           unique 12-digit primary key for this ledger entry
 *   - IDEMPOTENCY_KEY  the original payment request, shared by the SENT and
 *                      RECEIVED rows of a single transfer
 *
 * The list has a fixed maximum height and `overflow-y-auto`, so it scrolls
 * internally once the rows exceed the panel. It no longer polls: the rows come
 * from DashboardFeedProvider, refreshed by a server push only when a
 * transaction or notification actually changes.
 */

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied — the value is still selectable as text.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export default function TransactionHistory() {
  const { data } = useDashboardFeed();
  const items = data.transactions;

  return (
    <section className="rounded-xl border border-border">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-medium">Transaction history</h2>
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {items.length}
          </span>
        )}
      </header>

      <div className="max-h-[30rem] overflow-y-auto">
        {items.length === 0 ? (
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
              const trxId = t.trxId || "—";
              const idempotencyKey = t.idempotencyKey || t.reference || "—";
              return (
                <li key={t.trxId || t.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between gap-4">
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
                  </div>

                  {/* Identifiers for this transaction. The 12-digit TRX_ID is
                      the primary key; IDEMPOTENCY_KEY ties both sides of a
                      transfer back to the original payment request. */}
                  <div className="mt-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5">
                    <div className="flex items-center gap-2 font-mono text-[10px] leading-5">
                      <span className="w-[6.75rem] shrink-0 whitespace-nowrap font-sans text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                        TRX ID
                      </span>
                      <span className="tabular-nums text-foreground/80">{trxId}</span>
                      <CopyButton value={trxId} label="TRX ID" />
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[10px] leading-5">
                      <span className="w-[6.75rem] shrink-0 whitespace-nowrap font-sans text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                        Idempotency key
                      </span>
                      <span
                        className="min-w-0 break-all text-foreground/70"
                        title={idempotencyKey}
                      >
                        {idempotencyKey}
                      </span>
                      <CopyButton value={idempotencyKey} label="idempotency key" />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
