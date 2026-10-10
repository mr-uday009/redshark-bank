// Diagnostic endpoint: reports whether the app can reach Db2 for z/OS through
// the local JDBC bridge, which server it is talking to, and - importantly -
// whether password hashing is actually being performed by ICSF on the
// mainframe or has fallen back to Node's local SHA-256.
import { NextResponse } from "next/server";
import { testDb2Connection } from "@/lib/db2";
import { getHashSource } from "@/lib/auth-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const connection = await testDb2Connection();
  const hashing = getHashSource();
  return NextResponse.json({
    ...connection,
    hashing: {
      engine: hashing.source ?? (hashing.db2Configured ? "not exercised yet" : "local SHA-256"),
      db2Configured: hashing.db2Configured,
      lastError: hashing.error,
      note: hashing.db2Configured
        ? "When the ICSF call fails the app falls back to Node SHA-256. The digest is identical, so logins still work, but the password is then hashed in the web tier rather than on the mainframe."
        : undefined,
    },
  });
}
