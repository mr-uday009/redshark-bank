"use client";

// One fetch, one event stream, shared by every component on the dashboard.
//
// Both the bell and the history list read from this context, so a change
// signal produces exactly one /api/feed request rather than one per component.
//
// The initial snapshot is rendered on the server and passed in, so opening the
// dashboard costs zero API calls. After that the only traffic is:
//   - one long-lived SSE connection
//   - one conditional GET per real change (usually answered with 304)
//   - one refetch when the tab becomes visible again

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface FeedTransaction {
  id: number;
  direction: "SENT" | "RECEIVED";
  amount: string;
  counterparty: string;
  reference: string;
  createdAt: string;
}

export interface FeedNotification {
  id: number;
  kind: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface FeedData {
  transactions: FeedTransaction[];
  notifications: FeedNotification[];
  unread: number;
  version: string;
}

interface FeedContextValue {
  data: FeedData;
  /** True while the SSE connection is live. */
  connected: boolean;
  refresh: () => Promise<void>;
  dismiss: (id?: number) => Promise<void>;
}

const FeedContext = createContext<FeedContextValue | null>(null);

export function useDashboardFeed(): FeedContextValue {
  const value = useContext(FeedContext);
  if (!value) {
    throw new Error("useDashboardFeed must be used inside <DashboardFeedProvider>");
  }
  return value;
}

export default function DashboardFeedProvider({
  initial,
  children,
}: {
  initial: FeedData;
  children: ReactNode;
}) {
  const [data, setData] = useState<FeedData>(initial);
  const [connected, setConnected] = useState(false);

  const versionRef = useRef(initial.version);
  const inFlight = useRef<AbortController | null>(null);
  const initialVersionRef = useRef(initial.version);

  // After a send, SendDialog calls router.refresh(), which re-renders the
  // server component and hands down a newer snapshot. Adopt it — but compare
  // against the last snapshot the server gave us, not the current version, or
  // a stale prop would clobber a fresher push.
  useEffect(() => {
    if (initial.version === initialVersionRef.current) return;
    initialVersionRef.current = initial.version;
    versionRef.current = initial.version;
    setData(initial);
  }, [initial]);

  const refresh = useCallback(async () => {
    // A change event during an in-flight request supersedes it: the newer
    // request will return a snapshot at least as fresh.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const res = await fetch("/api/feed", {
        signal: controller.signal,
        // `no-cache` revalidates instead of skipping the cache, which is what
        // lets the browser send If-None-Match and accept a 304.
        cache: "no-cache",
        headers: { "If-None-Match": `"${versionRef.current}"` },
      });

      if (res.status === 304 || !res.ok) return;

      const next = (await res.json()) as FeedData;
      versionRef.current = next.version;
      setData(next);
    } catch {
      // Aborted, or the network is gone. The next signal retries.
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;
    let everConnected = false;

    function connect() {
      if (disposed) return;
      source = new EventSource("/api/feed/stream");

      source.addEventListener("ready", () => {
        attempt = 0;
        setConnected(true);
        // The server snapshot is fresh, so the first connection needs no
        // fetch. A reconnect may have missed signals, so catch up.
        if (everConnected) void refresh();
        everConnected = true;
      });

      source.addEventListener("change", () => {
        void refresh();
      });

      source.onerror = () => {
        setConnected(false);
        source?.close();
        source = null;
        if (disposed) return;

        // Back off so a server outage does not turn into a reconnect storm.
        attempt = Math.min(attempt + 1, 5);
        retryTimer = setTimeout(connect, Math.min(1_000 * 2 ** attempt, 30_000));
      };
    }

    connect();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  const dismiss = useCallback(
    async (id?: number) => {
      // Optimistic: the badge should drop the instant the user clicks.
      setData((prev) => {
        const notifications = prev.notifications.map((n) =>
          id === undefined || n.id === id ? { ...n, read: true } : n,
        );
        return {
          ...prev,
          notifications,
          unread: notifications.filter((n) => !n.read).length,
        };
      });

      try {
        const res = await fetch("/api/notifications/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(id === undefined ? {} : { id }),
        });
        if (!res.ok) await refresh();
      } catch {
        await refresh();
      }
    },
    [refresh],
  );

  return (
    <FeedContext.Provider value={{ data, connected, refresh, dismiss }}>
      {children}
    </FeedContext.Provider>
  );
}
