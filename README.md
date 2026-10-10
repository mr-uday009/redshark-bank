# Redshark Bank

A small online bank built on **IBM Db2 for z/OS**, with a local PostgreSQL
mirror so the site runs whether or not the mainframe is reachable.

Passwords are hashed with SHA-256 **on the mainframe**, by a COBOL stored
procedure that calls ICSF's `CSNBOWH` service. Node's `crypto` produces a
byte-identical digest, so the same credentials work against either database.

## Stack

| Layer | |
| --- | --- |
| App | Next.js 16 (App Router), React 19, Tailwind v4 |
| Mainframe | Db2 9.1 for z/OS (subsystem `DB9G`), COBOL, ICSF, JCL, WLM |
| Mirror | PostgreSQL 16 via Drizzle ORM |
| Bridge | Java 17 + `db2jcc4.jar`, exposed over local HTTP |

## How it fits together

```
Browser
   │
Next.js app ── auth-service.ts ──┬── JDBC bridge :8099 ── Db2 for z/OS ── ICSF
                                 │                              BANKAPP.HASHUD
                                 └── Drizzle ── PostgreSQL mirror
```

`isDb2Configured()` — literally "is `DB2_HOST` set" — decides which side runs.
Every read and write in `src/lib/auth-service.ts` and
`src/lib/transfer-service.ts` branches on it.

## Running it

```sh
cp .env.example .env     # then fill in your values
npm install
npm run dev
```

**Against the mainframe.** Uncomment the `DB2_*` block in `.env`, then start the
bridge in a second terminal:

```sh
cd db2/jdbc-bridge && ./run-bridge.sh
```

Confirm it is up and ICSF is reachable:

```sh
curl http://127.0.0.1:8099/health
# {"ok":true,"connected":true,"icsf":true,...}
```

**Against PostgreSQL.** Comment out `DB2_HOST` and restart. The mirror tables
come from `drizzle/`.

`GET /api/db2/status` reports which hashing engine actually ran (`icsf` or
`local`), so a silent fallback cannot hide.

## Features

- **Auth** — register, login, sessions. Token-bucket rate limiting on login
  (per IP *and* per account) and register.
- **Send & Receive** — move money between accounts by email, username, or
  account number. Password-confirmed, with the amount validated against the
  available balance. Both sides of every transfer are recorded and both parties
  notified.
- **Transaction history** — per-user ledger, newest first.

## Layout

| Path | What |
| --- | --- |
| `src/lib/auth-service.ts` | the database and hashing switches |
| `src/lib/transfer-service.ts` | money movement, both databases |
| `src/lib/db2.ts` | mainframe access over the bridge |
| `src/app/api/` | HTTP routes |
| `db2/` | mainframe side: SQL, COBOL, JCL, WLM, and the JDBC bridge |
| `drizzle/` | PostgreSQL migrations |

## Things that will bite you

**Db2 `CHAR` columns compared against user input.** `ACCOUNT_NUMBER = ?` fails
with `SQLCODE -302 / 22001` when the parameter is longer than 12 characters —
Db2 tries to *assign* rather than simply not match. Compare as strings:
`RTRIM(A.ACCOUNT_NUMBER) = CAST(? AS VARCHAR(255))`.

**`PARAMETER CCSID EBCDIC` on the stored procedure.** Without it Db2 passes
COBOL's EBCDIC output parameters through unconverted and the client chokes with
`-4220`. It cost the most time because the symptom looks like a parameter
linkage bug.

**`SETPROG APF,ADD` does not survive an IPL.** The APF entry for the procedure
library is lost on every restart, and `-444` comes back. See `db2/README.md`.

**Rate-limit state is an in-process `Map`.** Correct for one server; wrong the
moment the app is scaled horizontally. Move it to Redis before replicating.

**`src/db/index.ts` throws at import time** if `DATABASE_URL` is missing, even
in mainframe mode where Drizzle is never used. Keep it set.

## Not committed

`.env`, `node_modules/`, `.next/`, and the IBM JDBC jars — the latter are
IBM's and carry their own licence terms. See
`db2/jdbc-bridge/README.md` for how to obtain them.
