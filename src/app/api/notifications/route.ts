import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getNotificationsForUser } from "@/lib/transfer-service";

/** Notifications for the signed-in user, plus the unread count for the badge. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const result = await getNotificationsForUser(session.userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Notifications error:", err);
    return NextResponse.json(
      { error: "Could not load your notifications." },
      { status: 500 },
    );
  }
}
