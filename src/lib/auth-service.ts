// Auth orchestration layer.
//
// Deployment on the real mainframe (DB2_HOST configured):
//   plaintext password --> ICSF SHA-256 via COBOL stored procedure on z/OS
//   user row read/written in BANKAPP.USERS on Db2 for z/OS
//
// This sandbox / any environment without DB2_HOST configured:
//   plaintext password --> Node crypto SHA-256 (byte-identical algorithm)
//   user row read/written in the local Postgres mirror (src/db/schema.ts)
//
// Callers never need to know which mode is active, EXCEPT for the hashing
// source: if the ICSF call fails we fall back to Node's SHA-256. The digest is
// identical either way, so logins keep working, but the password is then being
// hashed in the web tier rather than on the mainframe. That is a meaningful
// difference and is reported through `lastHashSource` / `getHashSource()` so it
// is visible instead of silent.
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { authUsers, bankAccounts } from "@/db/schema";
import { sha256Hex, timingSafeEqualHex } from "@/lib/hash";
import {
  isDb2Configured,
  hashViaIcsf,
  findDb2AuthUser,
  insertDb2AuthUser,
  getDb2AccountsForUser,
  createDb2Account,
} from "@/lib/db2";

export interface PublicUser {
  userId: number;
  username: string;
  email: string;
  fullName: string;
}

export class AuthError extends Error {}

export type HashSource = "icsf" | "local";

let lastHashSource: HashSource | null = null;
let lastHashError: string | null = null;

/** Which engine produced the most recent password hash. */
export function getHashSource(): {
  source: HashSource | null;
  error: string | null;
  db2Configured: boolean;
} {
  return { source: lastHashSource, error: lastHashError, db2Configured: isDb2Configured() };
}

/**
 * Hash a plaintext password.
 *
 * Exported so the transfer flow can reuse the *same* decision — if a password
 * verifies at login it must verify when confirming a payment, and the only way
 * to guarantee that is to share one implementation rather than duplicate it.
 */
export async function hashPassword(plainText: string): Promise<{ hash: string; source: HashSource }> {
  if (isDb2Configured()) {
    try {
      const hash = await hashViaIcsf(plainText);
      lastHashSource = "icsf";
      lastHashError = null;
      return { hash, source: "icsf" };
    } catch (err) {
      lastHashSource = "local";
      lastHashError = err instanceof Error ? err.message : String(err);
      console.warn(
        "WARNING: ICSF hashing on z/OS failed - falling back to local SHA-256. " +
          "The digest is identical so login still works, but the password is NOT " +
          "being hashed on the mainframe. Reason:",
        lastHashError
      );
    }
  } else {
    lastHashSource = "local";
    lastHashError = null;
  }
  return { hash: sha256Hex(plainText), source: "local" };
}

function randomAccountNumber(): string {
  let digits = "";
  for (let i = 0; i < 12; i++) digits += Math.floor(Math.random() * 10).toString();
  return digits;
}

export async function registerUser(input: {
  username: string;
  email: string;
  fullName: string;
  password: string;
}): Promise<PublicUser> {
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();

  if (username.length < 3) throw new AuthError("Username must be at least 3 characters.");
  if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
    throw new AuthError("Username may only contain letters, numbers, dots, and underscores.");
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AuthError("Enter a valid email address.");
  if (!fullName) throw new AuthError("Full name is required.");
  if (input.password.length < 8) throw new AuthError("Password must be at least 8 characters.");

  const { hash } = await hashPassword(input.password);

  if (isDb2Configured()) {
    const created = await insertDb2AuthUser({ username, email, fullName, passwordHash: hash });
    // Give the new customer an opening account, same as the Postgres path.
    // Deliberately non-fatal: the user row is already committed, so failing the
    // whole registration because of the account insert would be wrong.
    try {
      await createDb2Account({
        userId: created.userId,
        accountNumber: randomAccountNumber(),
        accountType: "CHECKING",
        // balance: (5000 + Math.floor(Math.random() * 20000)).toFixed(2),
        balance: "0.00",
      });
    } catch (err) {
      console.error(
        `Registered ${created.username} (id ${created.userId}) but could not open ` +
          "the opening account:",
        err
      );
    }
    return created;
  }

  const existing = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(or(eq(authUsers.username, username), eq(authUsers.email, email)))
    .limit(1);
  if (existing.length > 0) {
    throw new AuthError("An account with that username or email already exists.");
  }

  const [row] = await db
    .insert(authUsers)
    .values({ username, email, fullName, passwordHash: hash })
    .returning({ id: authUsers.id, username: authUsers.username, email: authUsers.email, fullName: authUsers.fullName });

  await db.insert(bankAccounts).values({
    userId: row.id,
    accountNumber: randomAccountNumber(),
    accountType: "CHECKING",
    // balance: (5000 + Math.floor(Math.random() * 20000)).toFixed(2),
    balance: "0.00",
  });

  return { userId: row.id, username: row.username, email: row.email, fullName: row.fullName };
}

export async function authenticateUser(usernameOrEmail: string, password: string): Promise<PublicUser> {
  const identifier = usernameOrEmail.trim();
  if (!identifier || !password) throw new AuthError("Username/email and password are required.");

  if (isDb2Configured()) {
    const user = await findDb2AuthUser(identifier);
    if (!user) throw new AuthError("Invalid credentials.");
    const { hash } = await hashPassword(password);
    if (!timingSafeEqualHex(hash, user.passwordHash)) throw new AuthError("Invalid credentials.");
    return { userId: user.userId, username: user.username, email: user.email, fullName: user.fullName };
  }

  const [user] = await db
    .select()
    .from(authUsers)
    .where(and(or(eq(authUsers.username, identifier), eq(authUsers.email, identifier.toLowerCase()))))
    .limit(1);
  if (!user) throw new AuthError("Invalid credentials.");

  const { hash } = await hashPassword(password);
  if (!timingSafeEqualHex(hash, user.passwordHash)) throw new AuthError("Invalid credentials.");

  return { userId: user.id, username: user.username, email: user.email, fullName: user.fullName };
}

export interface AccountView {
  id: number;
  accountNumber: string;
  accountType: string;
  balance: string;
}

export async function getAccountsForUser(userId: number): Promise<AccountView[]> {
  if (isDb2Configured()) {
    const accounts = await getDb2AccountsForUser(userId);
    return accounts.map((a) => ({
      id: a.id,
      accountNumber: a.accountNumber,
      accountType: a.accountType,
      balance: a.balance,
    }));
  }
  const rows = await db.select().from(bankAccounts).where(eq(bankAccounts.userId, userId));
  return rows.map((a) => ({
    id: a.id,
    accountNumber: a.accountNumber,
    accountType: a.accountType,
    balance: String(a.balance),
  }));
}
