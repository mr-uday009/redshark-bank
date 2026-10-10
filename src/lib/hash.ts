// SHA-256 one-way hashing helper.
//
// On z/OS this exact digest is produced by ICSF's CSNBOWH callable
// service (rule array "SHA-256"/"ONLY") inside HASHUD.cbl - see
// db2/cobol/HASHUDSP.cbl. SHA-256 is a standardized algorithm, so
// Node's `crypto` implementation below yields byte-for-byte identical
// digests to ICSF for the same input. That means:
//
//   - Password hashes created while running locally against Postgres
//     (this sandbox) are 100% compatible with hashes that would be
//     produced by ICSF on the real z/OS box.
//   - When DB2_HOST is configured (see src/lib/db2.ts), the app instead
//     calls the mainframe COBOL stored procedure to do the hashing so
//     the plaintext password never has to be hashed off-mainframe.
import { createHash } from "crypto";

/**
 * Returns the uppercase hex SHA-256 digest of `text`, matching the
 * HEX-DISPLAY format produced by the HASHUD COBOL program.
 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").toUpperCase();
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
