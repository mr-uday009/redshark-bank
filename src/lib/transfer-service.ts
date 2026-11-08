/**
 * Transfers, transaction history, and notifications.
 *
 * Mirrors the shape of auth-service.ts: every operation branches on
 * isDb2Configured() and runs against either Db2 for z/OS (through the JDBC
 * bridge) or the local PostgreSQL mirror. The two paths return identical
 * shapes so nothing upstream needs to know which database is live.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { authUsers, bankAccounts, notifications, transactions } from "@/db/schema";
import {
  isDb2Configured,
  findDb2Recipient,
  sendDb2Transfer,
  getDb2Transactions,
  getDb2Notifications,
  dismissDb2Notifications,
  getDb2AccountsForUser,
  findDb2AuthUser,
  hashViaIcsf,
  type Db2Recipient,
} from "@/lib/db2";
import { hashPassword } from "@/lib/auth-service";
import { timingSafeEqualHex } from "@/lib/hash";
import { assertTrxId, normalizeIdempotencyKey } from "@/lib/transaction-ids";

export class TransferError extends Error {}

export interface Recipient {
  userId: number;
  username: string;
  email: string;
  fullName: string;
  accountId: number;
  accountNumber: string;
}

export interface TransactionRow {
  id: number;
  /** Unique 12-digit business primary key. */
  trxId: string;
  direction: "SENT" | "RECEIVED";
  amount: string;
  counterparty: string;
  reference: string;
  /** Identifies the original payment request. */
  idempotencyKey: string;
  createdAt: string;
}

export interface NotificationRow {
  id: number;
  kind: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface TransferResult {
  reference: string;
  /** 12-digit TRX_ID of the sender's ledger row. */
  trxId: string;
  idempotencyKey: string;
  amount: string;
  messageToSender: string;
  messageToRecipient: string;
  senderBalance: string;
  /** True when the original receipt was replayed instead of charging again. */
  duplicate?: boolean;
}

/** Money is compared as integers of cents — never as floats. */
function toCents(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Postgres allocates TRX_IDs from the same kind of 12-digit sequence that
 * BANKAPP.TRX_ID_SEQ provides on Db2. Sequences are non-transactional, so a
 * rolled-back transfer simply leaves a gap — never a duplicate.
 */
async function allocateTrxId(): Promise<string> {
  const { rows } = await pool.query<{ trx_id: string }>(
    "SELECT nextval('transactions_trx_id_seq')::text AS trx_id",
  );
  return assertTrxId(rows[0]?.trx_id);
}

/** Drizzle wraps the pg driver error; walk the cause chain to find 23505. */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      if ((current as { code?: string }).code === "23505") return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recipient lookup
// ---------------------------------------------------------------------------

/**
 * Find a payee by email, username, or account number.
 * Returns null when there is no match — the caller decides how to say so.
 */
export async function lookupRecipient(
  identifier: string,
  excludeUserId: number,
): Promise<Recipient | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (isDb2Configured()) {
    const r: Db2Recipient | null = await findDb2Recipient(trimmed, excludeUserId);
    if (!r) return null;
    return {
      userId: r.userId,
      username: r.username,
      email: r.email,
      fullName: r.fullName,
      accountId: r.accountId,
      accountNumber: r.accountNumber,
    };
  }

  // Postgres: match on username, email, or account number. Case-insensitive on
  // the text fields, exact on the account number.
  const rows = await db
    .select({
      userId: authUsers.id,
      username: authUsers.username,
      email: authUsers.email,
      fullName: authUsers.fullName,
      accountId: bankAccounts.id,
      accountNumber: bankAccounts.accountNumber,
    })
    .from(authUsers)
    .innerJoin(bankAccounts, eq(bankAccounts.userId, authUsers.id))
    .where(
      sql`upper(${authUsers.username}) = upper(${trimmed})
       OR upper(${authUsers.email}) = upper(${trimmed})
       OR ${bankAccounts.accountNumber} = ${trimmed}`,
    )
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Verify a password against the caller's stored hash.
 *
 * Deliberately reuses the same hashing path as login, so a transfer can never
 * succeed with a password that login would reject.
 *
 * On Db2 the lookup goes via `/user/find`, which matches on username or email
 * — the bridge has no lookup-by-id, and adding one would widen its surface for
 * no benefit when the caller's username is already in the session.
 */
async function verifyPassword(username: string, password: string): Promise<boolean> {
  if (isDb2Configured()) {
    const user = await findDb2AuthUser(username);
    if (!user) return false;
    const { hash } = await hashPassword(password);
    return timingSafeEqualHex(hash, user.passwordHash);
  }

  const rows = await db
    .select({ passwordHash: authUsers.passwordHash })
    .from(authUsers)
    .where(eq(authUsers.username, username))
    .limit(1);
  if (!rows[0]) return false;
  const { hash } = await hashPassword(password);
  return timingSafeEqualHex(hash, rows[0].passwordHash);
}

export interface SendInput {
  senderUserId: number;
  senderUsername: string;
  password: string;
  recipient: Recipient;
  /** Decimal string, e.g. "100.00". */
  amount: string;
  /** Optional client key identifying the original payment request. */
  idempotencyKey?: string;
}

/**
 * Send money.
 *
 * Validation order matters: cheap checks first, then the password, then the
 * balance — so a wrong password never reveals whether the amount was
 * affordable, and an unaffordable amount never costs a hashing round-trip.
 */
export async function sendTransfer(input: SendInput): Promise<TransferResult> {
  const cents = toCents(input.amount);
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new TransferError("Enter an amount greater than zero.");
  }
  if (input.recipient.userId === input.senderUserId) {
    throw new TransferError("You cannot send money to your own account.");
  }

  const amount = formatAmount(cents);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

  // 1. The sender must own an account with the funds.
  const senderAccount = await getPrimaryAccount(input.senderUserId);
  if (!senderAccount) throw new TransferError("Your account could not be found.");

  if (toCents(senderAccount.balance) < cents) {
    throw new TransferError(
      `Insufficient funds. Your available balance is $${senderAccount.balance}.`,
    );
  }

  // 2. Password confirmation.
  const ok = await verifyPassword(input.senderUsername, input.password);
  if (!ok) throw new TransferError("That password is not correct.");

  // 3. Hand off to the database, which does the debit/credit/ledger/notify
  //    atomically. The conditional debit there is the real guard against
  //    overdraw — the check above is only a fast, friendly pre-filter.
  if (isDb2Configured()) {
    const r = await sendDb2Transfer({
      senderUserId: input.senderUserId,
      senderAccountId: senderAccount.id,
      senderUsername: input.senderUsername,
      recipientUserId: input.recipient.userId,
      recipientAccountId: input.recipient.accountId,
      recipientUsername: input.recipient.username,
      amount,
      idempotencyKey,
    });
    return {
      reference: r.reference,
      trxId: r.trxId,
      idempotencyKey: r.idempotencyKey,
      amount: r.amount,
      messageToSender: r.messageToSender,
      messageToRecipient: r.messageToRecipient,
      senderBalance: r.senderBalance,
      duplicate: r.duplicate,
    };
  }

  return sendPostgresTransfer({
    senderUserId: input.senderUserId,
    senderUsername: input.senderUsername,
    senderAccountId: senderAccount.id,
    recipient: input.recipient,
    amount,
    cents,
    idempotencyKey,
  });
}

interface PrimaryAccount {
  id: number;
  accountNumber: string;
  balance: string;
}

export async function getPrimaryAccount(userId: number): Promise<PrimaryAccount | null> {
  if (isDb2Configured()) {
    const accounts = await getDb2AccountsForUser(userId);
    const first = accounts[0];
    return first
      ? { id: first.id, accountNumber: first.accountNumber, balance: first.balance }
      : null;
  }

  const rows = await db
    .select({
      id: bankAccounts.id,
      accountNumber: bankAccounts.accountNumber,
      balance: bankAccounts.balance,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.userId, userId))
    .orderBy(bankAccounts.id)
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Postgres transfer.
 *
 * Runs inside a transaction. The debit uses `balance - amount` guarded by
 * `balance >= amount` in the WHERE clause, exactly like the Db2 path, so the
 * same race argument holds: whoever loses the race updates zero rows.
 */
async function sendPostgresTransfer(args: {
  senderUserId: number;
  senderUsername: string;
  senderAccountId: number;
  recipient: Recipient;
  amount: string;
  cents: number;
  idempotencyKey: string;
}): Promise<TransferResult> {
  const reference = randomUUID();

  // Idempotency guard: replaying a request returns the original receipt and
  // never moves money twice. UNIQUE (idempotency_key, user_id) is the
  // database-level backstop for concurrent duplicates.
  const prior = await db
    .select({
      trxId: transactions.trxId,
      reference: transactions.reference,
      amount: transactions.amount,
      counterparty: transactions.counterparty,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.idempotencyKey, args.idempotencyKey),
        eq(transactions.userId, args.senderUserId),
        eq(transactions.direction, "SENT"),
      ),
    )
    .limit(1);

  if (prior[0]) {
    const account = await getPrimaryAccount(args.senderUserId);
    return {
      reference: prior[0].reference,
      trxId: prior[0].trxId,
      idempotencyKey: args.idempotencyKey,
      amount: prior[0].amount,
      messageToSender: `$${prior[0].amount} sent to ${prior[0].counterparty}`,
      messageToRecipient: `${args.senderUsername} sent $${prior[0].amount} to you`,
      senderBalance: account?.balance ?? "0",
      duplicate: true,
    };
  }

  // Each side of the ledger gets its own unique 12-digit TRX_ID.
  const senderTrxId = await allocateTrxId();
  const recipientTrxId = await allocateTrxId();

  try {
    return await db.transaction(async (tx) => {
      const debited = await tx
        .update(bankAccounts)
        .set({ balance: sql`${bankAccounts.balance} - ${args.amount}` })
        .where(
          and(
            eq(bankAccounts.id, args.senderAccountId),
            sql`${bankAccounts.balance} >= ${args.amount}`,
          ),
        )
        .returning({ balance: bankAccounts.balance });

      if (debited.length !== 1) {
        throw new TransferError(
          "Insufficient funds. The amount exceeds your available balance.",
        );
      }

      const credited = await tx
        .update(bankAccounts)
        .set({ balance: sql`${bankAccounts.balance} + ${args.amount}` })
        .where(eq(bankAccounts.id, args.recipient.accountId))
        .returning({ balance: bankAccounts.balance });

      if (credited.length !== 1) {
        throw new TransferError("The recipient's account could not be credited.");
      }

      await tx.insert(transactions).values([
        {
          trxId: senderTrxId,
          userId: args.senderUserId,
          accountId: args.senderAccountId,
          direction: "SENT",
          amount: args.amount,
          counterparty: args.recipient.username,
          reference,
          idempotencyKey: args.idempotencyKey,
        },
        {
          trxId: recipientTrxId,
          userId: args.recipient.userId,
          accountId: args.recipient.accountId,
          direction: "RECEIVED",
          amount: args.amount,
          counterparty: args.senderUsername,
          reference,
          idempotencyKey: args.idempotencyKey,
        },
      ]);

      const messageToRecipient = `${args.senderUsername} sent $${args.amount} to you`;
      const messageToSender = `$${args.amount} sent to ${args.recipient.username}`;

      await tx.insert(notifications).values([
        {
          userId: args.recipient.userId,
          kind: "money_received",
          message: messageToRecipient,
        },
        {
          userId: args.senderUserId,
          kind: "money_sent",
          message: messageToSender,
        },
      ]);

      return {
        reference,
        trxId: senderTrxId,
        idempotencyKey: args.idempotencyKey,
        amount: args.amount,
        messageToSender,
        messageToRecipient,
        senderBalance: debited[0].balance,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TransferError("This payment request has already been submitted.");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// History and notifications
// ---------------------------------------------------------------------------

export async function getTransactionsForUser(userId: number): Promise<TransactionRow[]> {
  if (isDb2Configured()) {
    const rows = await getDb2Transactions(userId);
    return rows.map((t) => ({
      id: t.id,
      trxId: t.trxId,
      direction: t.direction,
      amount: t.amount,
      counterparty: t.counterparty,
      reference: t.reference,
      idempotencyKey: t.idempotencyKey,
      createdAt: t.createdAt ?? "",
    }));
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(50);

  return rows.map((t) => ({
    id: t.id,
    trxId: t.trxId,
    direction: t.direction as "SENT" | "RECEIVED",
    amount: t.amount,
    counterparty: t.counterparty,
    reference: t.reference,
    idempotencyKey: t.idempotencyKey,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function getNotificationsForUser(
  userId: number,
): Promise<{ notifications: NotificationRow[]; unread: number }> {
  if (isDb2Configured()) {
    const r = await getDb2Notifications(userId);
    return {
      notifications: r.notifications.map((n) => ({
        id: n.id,
        kind: n.kind,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt ?? "",
      })),
      unread: r.unread,
    };
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(50);

  return {
    notifications: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })),
    unread: rows.filter((n) => !n.read).length,
  };
}

export async function dismissNotifications(
  userId: number,
  id?: number,
): Promise<number> {
  if (isDb2Configured()) {
    return dismissDb2Notifications(userId, id);
  }

  if (typeof id === "number") {
    const updated = await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    return updated.length;
  }

  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
    .returning({ id: notifications.id });
  return updated.length;
}

export { hashViaIcsf };
