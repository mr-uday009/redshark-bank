import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  sendTransfer,
  lookupRecipient,
  TransferError,
  type Recipient,
} from "@/lib/transfer-service";
import { checkTransferRateLimit } from "@/lib/auth-rate-limit";

/**
 * Send money to another Redshark account.
 *
 * The client sends only the *identifier* of the recipient, never an account id.
 * Re-resolving it here means a caller cannot redirect funds by tampering with
 * an id in the payload — the account credited is always the one the identifier
 * actually resolves to.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const limited = checkTransferRateLimit(request, session.username);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { identifier, amount, password } = body ?? {};

    if (typeof identifier !== "string" || typeof amount !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const recipient: Recipient | null = await lookupRecipient(identifier, session.userId);
    if (!recipient) {
      return NextResponse.json(
        { error: "We could not find a Redshark account with those details." },
        { status: 404 },
      );
    }

    const result = await sendTransfer({
      senderUserId: session.userId,
      senderUsername: session.username,
      password,
      recipient,
      amount,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      recipient: {
        username: recipient.username,
        fullName: recipient.fullName,
        accountNumber: recipient.accountNumber,
      },
    });
  } catch (err) {
    if (err instanceof TransferError) {
      // 402 for insufficient funds so the UI can style it distinctly; 400 for
      // everything else (bad amount, wrong password, self-send).
      const insufficient = /insufficient funds/i.test(err.message);
      return NextResponse.json({ error: err.message }, { status: insufficient ? 402 : 400 });
    }
    console.error("Transfer error:", err);
    return NextResponse.json(
      { error: "The transfer could not be completed. Please try again." },
      { status: 500 },
    );
  }
}
