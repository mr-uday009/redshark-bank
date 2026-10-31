// Server-side change bus for the dashboard feed.
//
// The dashboard used to poll two endpoints every five seconds per open tab.
// That is 1,440 requests/hour/tab, and every one of them ran a query even when
// nothing had changed.
//
// This module replaces the timer with an event: a write that affects a user
// publishes `pg_notify('feed_changes', ...)`, a single LISTEN connection per
// server process receives it, and the SSE route (api/feed/stream) pushes it to
// only the tabs belonging to that user.
//
// Using Postgres LISTEN/NOTIFY rather than a plain in-process EventEmitter
// means the signal still crosses process boundaries if the app is ever run as
// more than one instance. The emitter below is just the local fan-out point.
//
// Notifications are fire-and-forget by design: if the bus is down the data is
// still committed, and the SSE route's slow safety check will notice the
// change on its own. Losing a signal must never fail a transfer.

import { EventEmitter } from "node:events";
import { Client } from "pg";
import { pool } from "@/db";

const CHANNEL = "feed_changes";

export interface FeedChangePayload {
  userIds: number[];
  reason?: string;
  at?: number;
}

type FeedListener = (payload: FeedChangePayload) => void;

const globalForFeed = globalThis as typeof globalThis & {
  __feedEmitter?: EventEmitter;
  __feedClient?: Client | null;
  __feedReconnect?: ReturnType<typeof setTimeout> | null;
};

const emitter = globalForFeed.__feedEmitter ?? new EventEmitter();
// Every open dashboard subscribes; the default cap of 10 would warn needlessly.
emitter.setMaxListeners(0);
globalForFeed.__feedEmitter = emitter;

/**
 * Keep exactly one LISTEN connection per process, reconnecting if it drops.
 * A dropped listener is not fatal — the SSE route's safety check still catches
 * changes — but reconnecting keeps pushes near-instant.
 */
function ensureListener(): void {
  if (globalForFeed.__feedClient) return;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  globalForFeed.__feedClient = client;

  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    if (globalForFeed.__feedClient === client) globalForFeed.__feedClient = null;
    if (globalForFeed.__feedReconnect) return;
    globalForFeed.__feedReconnect = setTimeout(() => {
      globalForFeed.__feedReconnect = null;
      ensureListener();
    }, 2_000);
  };

  client.on("notification", (message) => {
    if (!message.payload) return;
    try {
      const payload = JSON.parse(message.payload) as FeedChangePayload;
      if (Array.isArray(payload.userIds) && payload.userIds.length > 0) {
        emitter.emit(CHANNEL, payload);
      }
    } catch {
      // A malformed payload is not worth tearing down a live stream over.
    }
  });

  client.on("error", drop);
  client.on("end", drop);

  client
    .connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .catch(() => {
      drop();
      void client.end().catch(() => {});
    });
}

/** Subscribe one SSE connection to changes for a single user. */
export function subscribeFeed(userId: number, listener: FeedListener): () => void {
  ensureListener();

  const handler = (payload: FeedChangePayload) => {
    if (payload.userIds.includes(userId)) listener(payload);
  };

  emitter.on(CHANNEL, handler);
  return () => {
    emitter.off(CHANNEL, handler);
  };
}

/**
 * Announce that something changed for these users.
 *
 * Called after a successful write, never before: a tab must not be told to
 * refetch data that has not been committed yet.
 */
export async function notifyFeedChange(userIds: number[], reason?: string): Promise<void> {
  const unique = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return;

  ensureListener();

  const payload: FeedChangePayload = { userIds: unique, reason, at: Date.now() };

  try {
    await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(payload)]);
  } catch (err) {
    // The write already succeeded; the safety check will pick it up.
    console.error("feed change notify failed:", err);
  }
}
