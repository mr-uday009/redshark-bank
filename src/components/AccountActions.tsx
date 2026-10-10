"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import SendDialog from "@/components/SendDialog";
import ReceiveDialog from "@/components/ReceiveDialog";

/**
 * Send / Receive buttons plus the dialogs they open.
 *
 * Kept as one client component so the page itself can stay a server component
 * and keep reading the balance straight from the database.
 */
export default function AccountActions({
  balance,
  accountNumber,
  accountType,
  username,
}: {
  balance: string;
  accountNumber: string;
  accountType: string;
  username: string;
}) {
  const router = useRouter();
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={() => setSendOpen(true)}
          disabled={!accountNumber}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 17L17 7" />
            <path d="M9 7h8v8" />
          </svg>
          Send
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => setReceiveOpen(true)}
          disabled={!accountNumber}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17 7L7 17" />
            <path d="M15 17H7V9" />
          </svg>
          Receive
        </Button>
      </div>

      <SendDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        balance={balance}
        onSent={() => router.refresh()}
      />

      <ReceiveDialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        accountNumber={accountNumber}
        accountType={accountType}
        username={username}
      />
    </>
  );
}
