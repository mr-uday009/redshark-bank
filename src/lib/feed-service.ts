// The dashboard's single read model.
//
// Transactions and notifications used to be two endpoints, fetched by two
// independent timers. They are one screen, so they are one snapshot: one
// session check, one round trip, one ETag.
//
// `version` is the ETag basis. It is derived from data the client already
// receives (newest id on each list, unread count, row counts), so it costs no
// extra query and stays correct in both Postgres and Db2 mode.

import { pool } from "@/db";
import { isDb2Configured } from "@/lib/db2";
import {
  getNotificationsForUser,
  getTransactionsForUser,
  type NotificationRow,
  type TransactionRow,
} from "@/lib/transfer-service";

export interface Feed {
  transactions: TransactionRow[];
  notifications: NotificationRow[];
  unread: number;
  version: string;
}

export async function getFeed(userId: number): Promise<Feed> {
  const [transactions, notifications] = await Promise.all([
    getTransactionsForUser(userId),
    getNotificationsForUser(userId),
  ]);

  const txHead = transactions[0]?.id ?? 0;
  const ntHead = notifications.notifications[0]?.id ?? 0;

  return {
    transactions,
    notifications: notifications.notifications,
    unread: notifications.unread,
    // Row counts are included so a deleted row (which leaves the max id
    // unchanged) still produces a new version.
    version: `v1.${txHead}.${ntHead}.${notifications.unread}.${transactions.length}.${notifications.notifications.length}`,
  };
}

/**
 * Cheap "has anything changed?" probe used by the SSE route's safety check.
 *
 * Returns null in Db2 mode: the local mirror tables do not reflect mainframe
 * data there, so a local probe would be misleading. Db2-mode changes are
 * announced by the write path instead.
 */
export async function getFeedVersion(userId: number): Promise<string | null> {
  if (isDb2Configured()) return null;

  try {
    const { rows } = await pool.query<{
      tx: string;
      nt: string;
      unread: string;
      txc: string;
      ntc: string;
    }>(
      `SELECT
         COALESCE((SELECT max(id) FROM transactions  WHERE user_id = $1), 0)::text AS tx,
         COALESCE((SELECT max(id) FROM notifications WHERE user_id = $1), 0)::text AS nt,
         COALESCE((SELECT count(*) FROM notifications WHERE user_id = $1 AND read = false), 0)::text AS unread,
         COALESCE((SELECT count(*) FROM transactions  WHERE user_id = $1), 0)::text AS txc,
         COALESCE((SELECT count(*) FROM notifications WHERE user_id = $1), 0)::text AS ntc`,
      [userId],
    );

    const row = rows[0];
    if (!row) return null;
    return `s1.${row.tx}.${row.nt}.${row.unread}.${row.txc}.${row.ntc}`;
  } catch (err) {
    console.error("feed version probe failed:", err);
    return null;
  }
}
