"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SuccessCheck } from "@/components/SuccessCheck";
import { formatAuthError } from "@/lib/utils";

type Step = "recipient" | "amount" | "password" | "processing" | "done";

interface FoundRecipient {
  userId: number;
  username: string;
  email: string;
  fullName: string;
  accountNumber: string;
}

export default function SendDialog({
  open,
  onClose,
  balance,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  balance: string;
  onSent: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("recipient");
  const [identifier, setIdentifier] = useState("");
  const [recipient, setRecipient] = useState<FoundRecipient | null>(null);
  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    amount: string;
    to: string;
    trxId?: string;
  } | null>(null);

  // One key per payment attempt. It stays stable across retries (wrong
  // password, dropped response, double submit) so the server can recognise a
  // replay and never charge the account twice. A fresh key is minted when the
  // dialog is reset for the next payment.
  const idempotencyKeyRef = useRef("");
  function paymentKey(): string {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    return idempotencyKeyRef.current;
  }

  function reset() {
    setStep("recipient");
    setIdentifier("");
    setRecipient(null);
    setAmount("");
    setPassword("");
    setError(null);
    setBusy(false);
    setReceipt(null);
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  function close() {
    reset();
    onClose();
  }

  const balanceCents = Math.round(Number(balance) * 100);
  const amountCents = Math.round(Number(amount || "0") * 100);
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountCents) && amountCents > 0;
  const overBalance = amountValid && amountCents > balanceCents;

  // ---- step 1: find the recipient -------------------------------------
  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recipients/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not search for that account.");
        return;
      }
      if (!data.recipient) {
        setError("No Redshark account matches that email, username, or account number.");
        return;
      }
      setRecipient(data.recipient);
      setStep("amount");
    } catch {
      setError("Could not search for that account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---- step 3: confirm with the password -------------------------------
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient) return;
    setError(null);
    setStep("processing");

    try {
      const res = await fetch("/api/transactions/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": paymentKey(),
        },
        body: JSON.stringify({ identifier, amount, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(formatAuthError(data));
        setStep("password");
        return;
      }
      setReceipt({
        amount: data.amount,
        to: recipient.username,
        trxId: data.trxId,
      });
      setStep("done");
      // Refresh the server-rendered balance and history behind the dialog.
      onSent();
      router.refresh();
    } catch {
      setError("The transfer could not be completed. Please try again.");
      setStep("password");
    }
  }

  return (
    <Dialog open={open} onClose={close} labelledBy="send-dialog-title">
      {step === "recipient" && (
        <form onSubmit={handleLookup}>
          <DialogHeader
            id="send-dialog-title"
            title="Send money"
            description="Enter a Redshark email, username, or account number."
          />
          <div className="space-y-2">
            <Label htmlFor="send-identifier">Recipient</Label>
            <Input
              id="send-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="jane.doe, jane@example.com, or 123456789012"
              required
            />
          </div>

          {error && (
            <Alert className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6 flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || !identifier.trim()}>
              {busy ? "Searching…" : "Find account"}
            </Button>
          </div>
        </form>
      )}

      {step === "amount" && recipient && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!amountValid || overBalance) return;
            setError(null);
            setStep("password");
          }}
        >
          <DialogHeader
            id="send-dialog-title"
            title="How much?"
            description={`Sending to ${recipient.fullName} (@${recipient.username})`}
          />

          <div className="mb-5 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Available balance
            </p>
            <p className="mt-0.5 text-lg font-medium tabular-nums">
              ${Number(balance).toFixed(2)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="send-amount">Amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="send-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="pl-7 text-base tabular-nums"
                aria-invalid={overBalance}
                required
              />
            </div>
          </div>

          {/* The balance check is the whole point of this step, so it is shown
              inline as soon as the number exceeds what is available. */}
          {overBalance && (
            <Alert className="mt-4">
              <AlertDescription>
                Not enough to send. Your available balance is $
                {Number(balance).toFixed(2)} — enter that amount or less.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setError(null);
                setStep("recipient");
              }}
            >
              Back
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!amountValid || overBalance}
            >
              Send
            </Button>
          </div>
        </form>
      )}

      {step === "password" && recipient && (
        <form onSubmit={handleSend}>
          <DialogHeader
            id="send-dialog-title"
            title="Confirm payment"
            description={`$${Number(amount).toFixed(2)} to @${recipient.username}`}
          />

          <div className="space-y-2">
            <Label htmlFor="send-password">Your account password</Label>
            <Input
              id="send-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <Alert className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setError(null);
                setPassword("");
                setStep("amount");
              }}
            >
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={!password}>
              Confirm and send
            </Button>
          </div>
        </form>
      )}

      {step === "processing" && (
        <div>
          <DialogHeader
            id="send-dialog-title"
            title="Processing payment"
            description="Please wait — do not close this window."
          />
          <Alert>
            <AlertDescription>
              Your transfer to @{recipient?.username} is being processed.
            </AlertDescription>
          </Alert>
          <div className="mt-5 flex items-center gap-3">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            <span className="text-sm text-muted-foreground">
              Contacting the bank…
            </span>
          </div>
        </div>
      )}

      {step === "done" && receipt && (
        <div>
          <SuccessCheck
            title={receipt.trxId ? "Payment sent" : "Payment confirmed"}
            subtitle={`$${receipt.amount} to @${receipt.to}`}
          />
          {receipt.trxId && (
            <div className="mt-5 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Transaction ID
              </p>
              <p className="mt-1 font-mono text-sm tabular-nums">{receipt.trxId}</p>
            </div>
          )}
          <Button className="mt-6 w-full" onClick={close}>
            Done
          </Button>
        </div>
      )}
    </Dialog>
  );
}
