import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getTransactionsForUser } from "@/lib/transfer-service";

/** Transaction history for the signed-in user. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const transactions = await getTransactionsForUser(session.userId);
    return NextResponse.json({ transactions });
  } catch (err) {
    console.error("Transaction history error:", err);
    return NextResponse.json(
      { error: "Could not load your transactions." },
      { status: 500 },
    );
  }
}
