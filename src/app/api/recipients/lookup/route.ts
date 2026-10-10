import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { lookupRecipient } from "@/lib/transfer-service";

/**
 * Resolve a payee from an email, username, or account number.
 *
 * Returns 200 with `{ recipient: null }` when nothing matches rather than a
 * 404 — "no such user" is a normal outcome of typing, not an error, and the
 * Send dialog needs to distinguish it from a failure.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const identifier = body?.identifier;

    if (typeof identifier !== "string" || !identifier.trim()) {
      return NextResponse.json({ error: "Enter an email, username, or account number." }, { status: 400 });
    }

    const recipient = await lookupRecipient(identifier, session.userId);

    if (recipient && recipient.userId === session.userId) {
      return NextResponse.json(
        { error: "That is your own account. Enter someone else's details." },
        { status: 400 },
      );
    }

    return NextResponse.json({ recipient });
  } catch (err) {
    console.error("Recipient lookup error:", err);
    return NextResponse.json(
      { error: "Could not search for that account. Please try again." },
      { status: 500 },
    );
  }
}
