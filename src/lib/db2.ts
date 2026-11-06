// Db2 for z/OS data access.
//
// The site talks to the mainframe through a small local JDBC bridge
// (db2/jdbc-bridge/Db2Bridge.java) rather than a Node database driver.
//
// Why: the only Db2 client that can reach z/OS without a paid Db2 Connect
// licence is the JDBC driver (db2jcc4.jar + the freely redistributable
// db2jcc_license_cisuz.jar). The Node `ibm_db` CLI/ODBC driver fails with
// SQL1598N ("licensing problem") even when the credentials are correct.
//
// The bridge exposes only fixed, parameterised operations - there is no
// generic SQL endpoint - so the web tier cannot execute arbitrary SQL.
//
// Configuration (.env):
//   DB2_HOST          when set, DB2 mode is enabled
//   DB2_PORT          default 5025
//   DB2_LOCATION      default DALLAS9
//   DB2_BRIDGE_URL    default http://127.0.0.1:8099
//
// Start the bridge with:
//   cd db2/jdbc-bridge
//   java -cp .:../db2jdbc/db2jcc4.jar:../db2jdbc/db2jcc_license_cisuz.jar Db2Bridge
//
// Whenever DB2_HOST is not set, every function below reports itself as
// "not configured" and the app falls back to the local Postgres mirror in
// src/db/schema.ts, so the site keeps working.

export interface Db2Settings {
  bridgeUrl: string;
  host: string;
  port: string;
  location: string;
}

export function getDb2Settings(): Db2Settings | null {
  const host = process.env.DB2_HOST;
  if (!host) return null;
  return {
    bridgeUrl: process.env.DB2_BRIDGE_URL ?? "http://127.0.0.1:8099",
    host,
    port: process.env.DB2_PORT ?? "5025",
    location: process.env.DB2_LOCATION ?? "DALLAS9",
  };
}

export function isDb2Configured(): boolean {
  return getDb2Settings() !== null;
}

/** Equivalent of `jdbc:db2://host:port/location`, for display/logging only. */
export function jdbcUrlFor(settings: Db2Settings): string {
  return `jdbc:db2://${settings.host}:${settings.port}/${settings.location}`;
}

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const settings = getDb2Settings();
  if (!settings) throw new Error("DB2_HOST is not configured.");

  const response = await fetch(`${settings.bridgeUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `DB2 bridge error (HTTP ${response.status})`);
  }
  if (!payload) throw new Error("DB2 bridge returned an empty response.");
  return payload;
}

/** Diagnostic: is the bridge up, is Db2 reachable, is ICSF hashing usable? */
export async function testDb2Connection() {
  const settings = getDb2Settings();
  if (!settings) {
    return {
      ok: false,
      configured: false,
      message: "DB2_HOST is not set - running against the local Postgres mirror instead.",
    };
  }
  try {
    const health = await call<{
      ok: boolean;
      url: string;
      connected: boolean;
      version?: string;
      icsf: boolean;
      icsfProbe?: string;
      icsfError?: string;
      error?: string;
    }>("/health");
    return {
      ok: health.connected,
      configured: true,
      url: health.url,
      version: health.version,
      icsf: health.icsf,
      icsfError: health.icsfError,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      url: jdbcUrlFor(settings),
      message: err instanceof Error ? err.message : "Unknown Db2 bridge error",
    };
  }
}

/**
 * Hashes plaintext by calling the mainframe COBOL stored procedure
 * BANKAPP.HASHUD, which invokes ICSF's CSNBOWH SHA-256 callable service.
 * The plaintext is therefore hashed entirely on z/OS; only the resulting
 * 64-character hex digest comes back.
 */
export async function hashViaIcsf(plainText: string): Promise<string> {
  const result = await call<{ hash: string; returnCode: number; reasonCode: number }>(
    "/hash",
    { method: "POST", body: { text: plainText } }
  );
  if (Number(result.returnCode) !== 0) {
    throw new Error(
      `ICSF hashing failed (return code ${result.returnCode}, reason code ${result.reasonCode})`
    );
  }
  return result.hash.trim().toUpperCase();
}

export interface Db2AuthUser {
  userId: number;
  username: string;
  email: string;
  fullName: string;
  passwordHash: string;
}

export async function findDb2AuthUser(usernameOrEmail: string): Promise<Db2AuthUser | null> {
  const result = await call<{ user: Db2AuthUser | null }>("/user/find", {
    method: "POST",
    body: { identifier: usernameOrEmail },
  });
  return result.user;
}

export async function insertDb2AuthUser(input: {
  username: string;
  email: string;
  fullName: string;
  passwordHash: string;
}): Promise<Db2AuthUser> {
  const result = await call<{ user: Db2AuthUser }>("/user/create", {
    method: "POST",
    body: input,
  });
  return result.user;
}

export interface Db2Account {
  id: number;
  userId: number;
  accountNumber: string;
  accountType: string;
  balance: string;
}

export async function getDb2AccountsForUser(userId: number): Promise<Db2Account[]> {
  const result = await call<{ accounts: Db2Account[] }>(`/accounts?userId=${userId}`);
  return result.accounts;
}

export async function createDb2Account(input: {
  userId: number;
  accountNumber: string;
  accountType: string;
  balance: string;
}): Promise<Db2Account> {
  const result = await call<{ account: Db2Account }>("/account/create", {
    method: "POST",
    body: input,
  });
  return result.account;
}

// ---------------------------------------------------------------------------
// Transfers and notifications
// ---------------------------------------------------------------------------

export interface Db2Recipient {
  userId: number;
  username: string;
  email: string;
  fullName: string;
  accountId: number;
  accountNumber: string;
  /** True when the caller looked themselves up. */
  isSelf: boolean;
}

/**
 * Resolve a payee by email, username, or account number.
 * Returns null when nothing matches, so the UI can say so rather than guess.
 */
export async function findDb2Recipient(
  identifier: string,
  excludeUserId: number,
): Promise<Db2Recipient | null> {
  const result = await call<{ recipient: Db2Recipient | null }>("/recipient/find", {
    method: "POST",
    body: { identifier, excludeUserId },
  });
  return result.recipient;
}

export interface Db2TransferResult {
  reference: string;
  /** 12-digit transaction id of the sender's SENT ledger row. */
  trxId: string;
  /** Identifies the original payment request; shared by both ledger rows. */
  idempotencyKey: string;
  amount: string;
  messageToSender: string;
  messageToRecipient: string;
  senderBalance: string;
  recipientBalance: string;
  /** True when a replayed key returned the original receipt without charging. */
  duplicate?: boolean;
}

/**
 * Move money and record both sides.
 *
 * The bridge does the whole thing in one Db2 transaction, and the debit is a
 * conditional UPDATE guarded by `BALANCE >= amount`, so an overdraw loses the
 * race and comes back as an "Insufficient funds" error rather than a negative
 * balance.
 */
export async function sendDb2Transfer(input: {
  senderUserId: number;
  senderAccountId: number;
  senderUsername: string;
  recipientUserId: number;
  recipientAccountId: number;
  recipientUsername: string;
  amount: string;
  reference?: string;
  /** Client-supplied key for the original payment request. */
  idempotencyKey?: string;
}): Promise<Db2TransferResult> {
  return call<Db2TransferResult>("/transfer", { method: "POST", body: input });
}

export interface Db2Transaction {
  id: number;
  /** Unique 12-digit business primary key. */
  trxId: string;
  direction: "SENT" | "RECEIVED";
  amount: string;
  counterparty: string;
  reference: string;
  /** Identifies the original payment request. */
  idempotencyKey: string;
  createdAt: string | null;
}

export async function getDb2Transactions(
  userId: number,
  limit = 50,
): Promise<Db2Transaction[]> {
  const result = await call<{ transactions: Db2Transaction[] }>(
    `/transactions?userId=${userId}&limit=${limit}`,
  );
  return result.transactions;
}

export interface Db2Notification {
  id: number;
  kind: string;
  message: string;
  read: boolean;
  createdAt: string | null;
}

export async function getDb2Notifications(
  userId: number,
): Promise<{ notifications: Db2Notification[]; unread: number }> {
  return call<{ notifications: Db2Notification[]; unread: number }>(
    `/notifications?userId=${userId}`,
  );
}

/** Dismiss one notification by id, or all of them when `id` is omitted. */
export async function dismissDb2Notifications(
  userId: number,
  id?: number,
): Promise<number> {
  const result = await call<{ dismissed: number }>("/notifications/dismiss", {
    method: "POST",
    body: { userId, id: id ?? 0 },
  });
  return result.dismissed;
}
