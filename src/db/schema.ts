// Local (sandbox / non-mainframe) persistence layer.
//
// In a real deployment against IBM Db2 for z/OS, these same logical tables
// (AUTHUSER / ACCOUNTS / TRANSACTIONS / NOTIFICATIONS) live on the mainframe
// and are reached over JDBC (see src/lib/db2.ts + db2/sql/). This Postgres
// schema is a drop-in mirror used automatically whenever the app is running
// without a configured z/OS connection, so the site is always fully
// functional end-to-end.
import {
  pgTable,
  pgSequence,
  serial,
  integer,
  varchar,
  numeric,
  timestamp,
  boolean,
  uniqueIndex,
  unique,
  index,
} from "drizzle-orm/pg-core";

// Mirrors mainframe table BANKAPP.AUTHUSER
export const authUsers = pgTable(
  "auth_users",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 50 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    // 64 hex chars = SHA-256 digest, identical format to the ICSF
    // CSNBOWH callable-service output produced by HASHUD.cbl.
    passwordHash: varchar("password_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usernameIdx: uniqueIndex("auth_users_username_idx").on(table.username),
    emailIdx: uniqueIndex("auth_users_email_idx").on(table.email),
  })
);

// Mirrors mainframe table BANKAPP.ACCOUNTS
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accountNumber: varchar("account_number", { length: 20 }).notNull(),
    accountType: varchar("account_type", { length: 20 }).notNull().default("CHECKING"),
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountNumberIdx: uniqueIndex("bank_accounts_number_idx").on(table.accountNumber),
  })
);

// Allocates the numeric part of TRX_ID. Starting at 200000000000 keeps live
// IDs in a separate range from the 100000000000+id values used to backfill
// historical rows, so a fresh sequence can never collide with a legacy row.
// Both this sequence and BANKAPP.TRX_ID_SEQ on Db2 use the same range.
export const transactionsTrxIdSeq = pgSequence("transactions_trx_id_seq", {
  startWith: 200_000_000_000,
  increment: 1,
  minValue: 200_000_000_000,
  maxValue: 999_999_999_999,
  cycle: false,
});

// Mirrors mainframe table BANKAPP.TRANSACTIONS.
//
// One row per *side* of a transfer: a SENT row for the payer and a RECEIVED
// row for the payee, linked by `reference`. Storing both sides means the
// history query is a plain indexed lookup on user_id, with no self-join and
// no risk of one side going missing.
//
// TRX_ID is the business primary key: a unique, 12-digit decimal identifier
// (CHAR(12) on Db2). IDEMPOTENCY_KEY identifies the original payment request
// and is shared by both sides of a single transfer. Because one request
// produces two rows, the uniqueness rule is per (request, account): the same
// key may appear once for the sender and once for the recipient, but a given
// account can never submit the same request twice.
export const transactions = pgTable(
  "transactions",
  {
    // Surrogate row identity, kept for ordering and the feed version probe.
    id: serial("id").notNull(),
    // Business primary key: unique 12-digit transaction identifier.
    trxId: varchar("trx_id", { length: 12 }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull(),
    // SENT | RECEIVED
    direction: varchar("direction", { length: 10 }).notNull(),
    // Always positive; `direction` carries the sign.
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    // Username of the other party, denormalised so history renders without a join.
    counterparty: varchar("counterparty", { length: 50 }).notNull(),
    reference: varchar("reference", { length: 36 }).notNull(),
    // Identifies the original payment request.
    idempotencyKey: varchar("idempotency_key", { length: 36 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idIdx: uniqueIndex("transactions_id_idx").on(table.id),
    userIdx: index("transactions_user_idx").on(table.userId, table.createdAt),
    // Prevents reuse of an idempotency key by the same account.
    idempotencyUq: unique("transactions_idempotency_uq").on(
      table.idempotencyKey,
      table.userId,
    ),
  })
);

// Mirrors mainframe table BANKAPP.NOTIFICATIONS
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    // money_sent | money_received | info
    kind: varchar("kind", { length: 24 }).notNull().default("info"),
    message: varchar("message", { length: 255 }).notNull(),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("notifications_user_idx").on(table.userId, table.read),
  })
);
