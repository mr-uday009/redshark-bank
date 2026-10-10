"use client";

import { useState } from "react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Receive: show the details someone else needs in order to send to you.
 * The account number is the thing the Send flow accepts, so it is the focus.
 */
export default function ReceiveDialog({
  open,
  onClose,
  accountNumber,
  accountType,
  username,
}: {
  open: boolean;
  onClose: () => void;
  accountNumber: string;
  accountType: string;
  username: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="receive-dialog-title">
      <DialogHeader
        id="receive-dialog-title"
        title="Receive money"
        description="Share these details so someone can send to you."
      />

      <div className="rounded-xl border border-border bg-muted/40 px-4 py-5 text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {accountType} account
        </p>
        <p className="mt-2 font-mono text-xl tracking-wide tabular-nums">
          {accountNumber}
        </p>
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Username</dt>
          <dd className="font-medium">@{username}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Bank</dt>
          <dd className="font-medium">Redshark Bank</dd>
        </div>
      </dl>

      <div className="mt-6 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Close
        </Button>
        <Button className="flex-1" onClick={copy}>
          {copied ? "Copied" : "Copy account number"}
        </Button>
      </div>
    </Dialog>
  );
}
