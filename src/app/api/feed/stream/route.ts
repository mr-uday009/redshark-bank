import { getSession } from "@/lib/session";
import { subscribeFeed } from "@/lib/feed-events";
import { getFeedVersion } from "@/lib/feed-service";

/**
 * Server-sent events for the dashboard.
 *
 * One request per open tab, held open. The server writes to it only when
 * something actually changed for that user — so an idle dashboard makes zero
 * API calls, where the old timer made 1,440 an hour.
 *
 * The client never receives the data here; it receives a `change` signal and
 * then does one conditional GET /api/feed, which returns 304 if the signal was
 * for something it already has.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Comment frames keep intermediaries from dropping an idle connection. */
const HEARTBEAT_MS = 25_000;

/**
 * Backstop for changes the bus cannot see — a notification lost because the
 * LISTEN connection was reconnecting, or a row written outside this app.
 * Deliberately slow: it is a safety net, not the delivery mechanism.
 */
const SAFETY_MS = 45_000;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.userId;
  const encoder = new TextEncoder();

  let stopStream: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let safety: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;

      function stop() {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (safety) clearInterval(safety);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // The consumer may already have gone away.
        }
      }

      stopStream = stop;

      function write(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Enqueue after the client disconnected: shut the timers down.
          stop();
        }
      }

      function send(event: string, data: unknown) {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      // Tell the browser how long to wait before reconnecting on its own.
      write("retry: 3000\n\n");
      send("ready", { at: Date.now() });

      let lastVersion = await getFeedVersion(userId);

      unsubscribe = subscribeFeed(userId, (payload) => {
        send("change", { reason: payload.reason ?? "write", at: Date.now() });
      });

      heartbeat = setInterval(() => write(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);

      safety = setInterval(() => {
        void (async () => {
          if (closed) return;
          const next = await getFeedVersion(userId);
          if (!next || next === lastVersion) return;
          lastVersion = next;
          send("change", { reason: "safety", at: Date.now() });
        })();
      }, SAFETY_MS);

      request.signal.addEventListener("abort", stop);
    },

    cancel() {
      stopStream();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx and friends buffer responses by default, which would hold the
      // events back until the buffer filled.
      "X-Accel-Buffering": "no",
    },
  });
}
