import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getFeed } from "@/lib/feed-service";

/**
 * One snapshot of everything the dashboard shows.
 *
 * Conditional: the client sends If-None-Match with the version it already has,
 * and an unchanged dashboard costs a 304 with no body instead of re-sending
 * the full transaction and notification lists.
 *
 * `no-cache` (not `no-store`) is deliberate — it permits the browser to keep a
 * copy for revalidation, which is what makes the 304 possible.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const feed = await getFeed(session.userId);
    const etag = `"${feed.version}"`;

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag)) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    return NextResponse.json(feed, {
      headers: {
        ETag: etag,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    console.error("Feed error:", err);
    return NextResponse.json(
      { error: "Could not load your dashboard." },
      { status: 500 },
    );
  }
}
