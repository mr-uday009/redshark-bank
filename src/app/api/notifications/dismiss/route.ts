import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { dismissNotifications } from "@/lib/transfer-service";
import { notifyFeedChange } from "@/lib/feed-events";

/**
 * Dismiss one notification (pass `id`) or all of them (omit `id`).
 * Scoped to the session's user, so one account can never clear another's.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawId = body?.id;
    const id = typeof rawId === "number" && rawId > 0 ? rawId : undefined;

    const dismissed = await dismissNotifications(session.userId, id);

    // Only this user's unread badge moves, so only their tabs are notified.
    await notifyFeedChange([session.userId], "notifications-read");

    return NextResponse.json({ dismissed });
  } catch (err) {
    console.error("Dismiss notifications error:", err);
    return NextResponse.json(
      { error: "Could not dismiss notifications." },
      { status: 500 },
    );
  }
}
