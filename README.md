# Redshark Bank

A small online bank that runs against **PostgreSQL** and/or **IBM Db2 for z/OS**.

The site is fully functional without a mainframe: PostgreSQL is the always-available
local store, and Db2 for z/OS is the optional system of record. Passwords are
hashed with SHA-256 — in Db2 mode **on the mainframe**, by a COBOL stored
procedure (`BANKAPP.HASHUD`) calling ICSF's `CSNBOWH`. Node's `crypto` produces a
byte-identical digest, so the same credentials work against either database.

Setting `DB2_HOST` is the only switch. When it is set, every read and write goes
to the mainframe through a local JDBC bridge; when it is unset, everything runs
against PostgreSQL.

> [!IMPORTANT]
> **Bring your own IBM Db2 JDBC drivers.** This project does **not** provide,
> bundle, mirror or ship `db2jcc4.jar` and `db2jcc_license_cisuz.jar`. They are
> IBM-licensed binaries that cannot be redistributed from this repository. You
> must obtain them yourself — from your own Db2 installation, your z/OS system,
> or your IBM entitlement — and place them in `db2/db2jdbc/` before the bridge
> will compile or start. **Db2 mode will not work without them.** Please do not
> open issues asking for the jars; they are excluded by design. See
> [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers).
> PostgreSQL mode needs none of this.

> **New here?** Jump to [Quick start](#quick-start-postgresql-mode). You need
> Node.js, PostgreSQL, and about five minutes. No mainframe, no Java, no JDBC
> jars, no 3270 terminal required. Db2 mode is entirely optional and documented
> separately in [Db2 for z/OS mode](#db2-for-zos-mode-optional).

---

## Contents

- [Security notes](#security-notes)
- [Stack](#stack)
- [How it fits together](#how-it-fits-together)
- [Requirements](#requirements)
- [Quick start (PostgreSQL mode)](#quick-start-postgresql-mode)
- [Configuration reference](#configuration-reference)
- [Database schema](#database-schema)
- [HTTP API](#http-api)
- [Db2 for z/OS mode (optional)](#db2-for-zos-mode-optional)
  - [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers)
- [Verification checklist](#verification-checklist)
- [Day-to-day operation](#day-to-day-operation)
- [Troubleshooting](#troubleshooting)
- [Repository layout](#repository-layout)
- [Not committed](#not-committed)

---

## Security notes

- `.env` is git-ignored. Never commit `DB2_PASSWORD` or `SESSION_SECRET`.
- `SESSION_SECRET` must be a real random value outside local development.
- The JDBC bridge exposes fixed parameterised operations only. There is
  deliberately no generic SQL endpoint; **do not add one**.
- The transfer's debit is a conditional `UPDATE ... WHERE BALANCE >= amount`
  inside a single transaction, so an overdraw loses the race instead of
  producing a negative balance. The application-level check is only a friendly
  pre-filter.
- Money is compared as integer cents / `DECIMAL(14,2)`, never floats.
- If the ICSF call fails, the app falls back to Node SHA-256 so logins keep
  working — but the plaintext was then hashed in the web tier. This is reported
  through `/api/db2/status` rather than hidden.
- The bridge listens on loopback by default. Do not expose it to untrusted
  networks.
- This is a demonstration project: sessions are signed cookies with an 8-hour
  lifetime, rate limiting is in-process, and there is no CSRF-token layer,
  audit trail, or KYC. Do not use it to hold real money.

---

## Stack

| Layer | Technology |
| --- | --- |
| App | Next.js 16 (App Router), React 19, Tailwind CSS v4, TypeScript |
| Local store | PostgreSQL 16 via Drizzle ORM |
| Mainframe | **Db2 for z/OS V9 or later**, COBOL, ICSF, JCL, WLM |
| Bridge | Java 17 + IBM JDBC jars (**supplied by you**), local HTTP on `127.0.0.1:8099` |
| Auth | Signed, HTTP-only session cookies; SHA-256 password digests |

## How it fits together

```
Browser
   │
Next.js app ── src/lib/*.ts ──┬── JDBC bridge :8099 ── Db2 for z/OS ── ICSF
                              │                          BANKAPP.HASHUD
                              └── Drizzle ──── PostgreSQL :5432
```

`isDb2Configured()` — literally "is `DB2_HOST` set" — decides which side runs.
Every read and write in `src/lib/auth-service.ts` and
`src/lib/transfer-service.ts` branches on it. `GET /api/db2/status` reports which
hashing engine actually ran (`icsf` or `local`), so a silent fallback cannot hide.

The bridge deliberately exposes **fixed, parameterised operations only**. There is
no generic SQL endpoint, so a compromised web tier cannot run arbitrary SQL.

---

## Requirements

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 22.x | `node --version` |
| npm | 10+ | `npm --version` |
| PostgreSQL | 16 (14+ works) | `psql --version` |
| Git | any recent | `git --version` |
| JDK | 17+ — **Db2 mode only** | `java -version` |
| IBM Db2 JDBC driver jars | your own licensed copy — **Db2 mode only, bring your own** | `ls db2/db2jdbc/*.jar` |
| 3270 terminal | **Db2 mode only** (e.g. x3270, pw3270, a TN3270 emulator) | — |

Db2 mode targets **Db2 for z/OS V9 or later** (V9, V10, V11, V12, V13 …). The
SQL, JCL and COBOL in this repository were authored against V9; substitute the
library, plan and load-module names that match your release.

> [!IMPORTANT]
> The IBM JDBC driver jars are **not supplied with this project**. Obtain them
> yourself before attempting Db2 mode — see
> [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers).

### Platform support

| Platform | PostgreSQL mode | Db2 for z/OS mode |
| --- | --- | --- |
| macOS | native | native (JDK 17 + a POSIX shell) |
| Linux | native | native |
| Windows | native (Node + PostgreSQL for Windows) | **WSL2** — the bridge scripts are POSIX shell and use a `:`-separated Java classpath |

Shell examples below are POSIX. On native Windows use the equivalents (`copy`
for `cp`, `curl.exe` rather than PowerShell's `curl` alias), or run them in Git
Bash / WSL2.

### Install the prerequisites

**macOS (Homebrew)**

```sh
brew install git node@22 postgresql@16 openjdk@17
brew services start postgresql@16

# Make the JDK visible to Java tooling
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk \
  /Library/Java/JavaVirtualMachines/openjdk-17.jdk
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

**Debian / Ubuntu**

```sh
sudo apt update
sudo apt install -y git curl postgresql openjdk-17-jdk
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo systemctl enable --now postgresql
```

> The `postgresql-16` package is only needed when your distribution does not
> already ship 16. Substitute your distribution's package name as appropriate.

**Fedora / RHEL**

```sh
sudo dnf install -y git curl postgresql-server java-17-openjdk-devel nodejs
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

**Windows**

Install Node.js 22, PostgreSQL for Windows, Git for Windows, and (for Db2 mode)
a JDK 17 inside WSL2. For Db2 mode, do the entire setup inside WSL2 so the
bridge scripts and Java classpath work unchanged.

---

## Quick start (PostgreSQL mode)

### 1. Get the code

```sh
git clone https://github.com/mr-uday009/redshark-bank.git
cd redshark-bank
npm install
```

`main` is the stable branch. If you are working from a fork or a feature branch,
check where you are first with `git branch --show-current` and `git status --short`.

### 2. Create the database

The app expects a database named `app_db` and a PostgreSQL role matching the one
in `DATABASE_URL`.

```sh
createdb app_db                 # macOS/Homebrew: runs as your own OS user
psql -d app_db -c "select current_user, current_database();"
```

On Linux, PostgreSQL uses peer authentication for local connections, so run as
the `postgres` OS account and create a role for yourself:

```sh
sudo -u postgres createuser -s <your-username>
sudo -u postgres createdb -O <your-username> app_db
psql -d app_db -c "select current_user, current_database();"
```

On Windows, use `createdb`/`psql` from the PostgreSQL `bin` directory, or create
the database and role in pgAdmin.

### 3. Apply the schema

The simplest, platform-independent route is to apply the committed SQL
migrations directly:

```sh
psql -d app_db -f drizzle/0000_orange_magus.sql
psql -d app_db -f drizzle/0001_transactions_notifications.sql
psql -d app_db -c "\dt"
```

Alternatively, use Drizzle Kit. **Before running it**, edit
`drizzle.config.json` — it ships with a hard-coded example URL that will not
match a fresh machine:

```json
{
  "dialect": "postgresql",
  "schema": "./src/db/schema.ts",
  "dbCredentials": { "url": "postgresql://<user>@localhost:5432/app_db" }
}
```

Drizzle Kit reads that file, **not** `.env`. Then:

```sh
npx drizzle-kit push
```

### 4. Configure `.env`

```sh
cp .env.example .env
```

> **Important — the shipped template is in Db2 mode.** `.env.example` ships with
> a `DB2_*` block that points at a sample lab LPAR. For PostgreSQL mode,
> **comment out every `DB2_*` line** (at minimum `DB2_HOST`). If you leave
> `DB2_HOST` set, the app will try to reach a mainframe that is not there.

Minimum PostgreSQL-mode `.env`:

```dotenv
DATABASE_URL=postgresql://<user>@localhost:5432/app_db
SESSION_SECRET=<a-long-random-string>
```

Generate a real secret (works on every platform, no extra tools needed):

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`SESSION_SECRET` is not present in the shipped `.env.example` yet — add the line
manually. It defaults to `dev-only-insecure-secret-change-me` when omitted,
which is fine locally and must not be used in production.

Keep `DATABASE_URL` set **even in Db2 mode**: `src/db/index.ts` throws at import
time when it is missing, and `/api/health` always runs `SELECT 1` against
PostgreSQL. PostgreSQL must be running in both modes.

### 5. Run

```sh
npm run dev
```

Open <http://localhost:3000/register>, create an account, then log in.
Registration opens a CHECKING account with a `0.00` balance. To exercise
transfers, give yourself funds and register a second user:

```sh
psql -d app_db -c "update bank_accounts set balance = 500.00 where user_id = 1;"
```

Useful checks:

```sh
curl -s http://localhost:3000/api/health          # {"ok":true}
curl -s http://localhost:3000/api/db2/status     # configured:false
npm run typecheck
npm run lint
npm run build
```

---

## Configuration reference

All settings live in `.env` (git-ignored). Secrets are shown as `<...>` and
should never be committed.

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Next.js | — **required** | PostgreSQL connection string. Always keep it set. |
| `SESSION_SECRET` | Next.js | insecure dev value | HMAC key for session cookies. Set a random value in production. |
| `DB2_HOST` | Next.js + bridge | — | **The mode switch.** Set = Db2 mode; unset = PostgreSQL mode. |
| `DB2_PORT` | Next.js + bridge | `5025` | Db2 DRDA port. |
| `DB2_LOCATION` | Next.js + bridge | `DALLAS9` | Db2 location name. |
| `DB2_USER` | bridge | `IBMUSER` | z/OS userid for JDBC. |
| `DB2_PASSWORD` | bridge | *(none — supply it)* | z/OS password. Secret. |
| `DB2_BRIDGE_URL` | Next.js | `http://127.0.0.1:8099` | Where the app finds the bridge. |
| `BRIDGE_HOST` | bridge | `127.0.0.1` | Bridge listen address. Keep it loopback. |
| `BRIDGE_PORT` | bridge | `8099` | Bridge listen port. |
| `JAVA_HOME` | `run-bridge.sh` | auto-detected | JDK 17+ install, if `java` is not on `PATH`. |
| `RATE_LIMIT_LOGIN_IP_MAX` / `_WINDOW` | Next.js | `20` / `300` | Login attempts per IP (bucket size / refill seconds). |
| `RATE_LIMIT_LOGIN_ACCT_MAX` / `_WINDOW` | Next.js | `5` / `300` | Login attempts per account. |
| `RATE_LIMIT_REGISTER_IP_MAX` / `_WINDOW` | Next.js | `5` / `3600` | Registrations per IP. |
| `RATE_LIMIT_TRANSFER_MAX` / `_WINDOW` | Next.js | `10` / `60` | Transfers per session. |

> The bridge is a separate process and **does not read `.env`**. Export its
> `DB2_*` variables in the shell that starts it (see
> [Start the bridge](#5-start-the-jdbc-bridge)). The Next.js app reads `.env`;
> the bridge reads process environment. Both need the same values.

> The sample values in `.env.example` and the defaults in `run-bridge.sh`
> (`DALLAS9`, `IBMUSER`, port `5025`, the sample host) come from an ADCD lab
> LPAR. Replace them with the host, port, location, userid and password of your
> own z/OS system.

---

## Database schema

Four tables, mirrored on both databases. One transfer produces **two** ledger
rows — a `SENT` row for the payer and a `RECEIVED` row for the payee — linked by
`reference`, so history is a single indexed lookup per user.

| PostgreSQL | Db2 for z/OS | Purpose |
| --- | --- | --- |
| `auth_users` | `BANKAPP.USERS` | Credentials; `password_hash` holds a 64-char SHA-256 hex digest. |
| `bank_accounts` | `BANKAPP.ACCOUNTS` | One or more accounts per user; `DECIMAL(14,2)` balance. |
| `transactions` | `BANKAPP.TRANSACTIONS` | One row per side of a transfer. |
| `notifications` | `BANKAPP.NOTIFICATIONS` | `money_sent` / `money_received`, with a read flag. |

The authoritative definitions are `src/db/schema.ts` and `drizzle/*.sql` for
PostgreSQL, and `db2/sql/01-create-objects.sql` plus
`db2/sql/09-transactions-notifications.sql` for Db2.

### Transaction identifiers

Every ledger row carries two identifiers, and both are shown under each entry in
the Transaction history panel.

| Column | PostgreSQL | Db2 for z/OS | Rule |
| --- | --- | --- | --- |
| `TRX_ID` | `varchar(12)` | `CHAR(12)` | Unique **12-digit decimal**, the business `PRIMARY KEY`. |
| `IDEMPOTENCY_KEY` | `varchar(36)` | `CHAR(36)` | Identifies the original payment request. |

* **`TRX_ID` is allocated by a sequence**, so it is unique by construction and
  the primary key rejects any collision. PostgreSQL uses
  `transactions_trx_id_seq`, Db2 uses `BANKAPP.TRX_ID_SEQ`; both start at
  `200000000000`. Historical rows were backfilled as `100000000000 + id`, a
  disjoint range, so the sequence can never reissue one of them.
* **`IDEMPOTENCY_KEY` is shared by the `SENT` and `RECEIVED` rows** of one
  transfer, because both belong to the same request. Uniqueness is therefore
  per account: `UNIQUE (idempotency_key, user_id)` lets the two sides coexist
  while preventing either account from replaying the same request.
* Sending the same key twice is safe. The server returns the original receipt
  with `duplicate: true` and does not move money again; the `UNIQUE` constraint
  is the backstop for two concurrent copies of the same request.

`POST /api/transactions/send` accepts the key as an `Idempotency-Key` header
(or an `idempotencyKey` body field). The browser generates one UUID per payment
attempt and reuses it across retries.

Upgrading an existing Db2 installation? Run `db2/sql/10-trx-id-idempotency.sql`
once. Db2 9.1 cannot `ALTER COLUMN … SET NOT NULL`, so that script rebuilds the
table while preserving every row, ID, and timestamp. Fresh installs only need
the updated `09` script.

---

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness (also checks PostgreSQL). |
| GET | `/api/db2/status` | Which database is active and which hash engine actually ran. |
| POST | `/api/auth/register` | `{username,email,fullName,password}` |
| POST | `/api/auth/login` | `{usernameOrEmail,password}` |
| POST | `/api/auth/logout` | End the session. |
| GET | `/api/auth/me` | Current session. |
| POST | `/api/recipients/lookup` | `{identifier}` → payee, by username, email, or account number. |
| GET | `/api/transactions` | Last 50 ledger rows. |
| POST | `/api/transactions/send` | `{identifier,amount,password}` — password-confirmed. Send an `Idempotency-Key` header to make retries safe. Returns `trxId` and `idempotencyKey`. |
| GET | `/api/notifications` | Last 50 plus an `unread` count. |
| POST | `/api/notifications/dismiss` | `{id}` or `{}` for all. |
| GET | `/api/feed` | One dashboard snapshot, with ETag / `304` support. |
| GET | `/api/feed/stream` | Server-sent events: a `change` signal, not the data itself. |

On branches that predate the event-driven feed, the dashboard polls
`/api/transactions` and `/api/notifications` instead.

---

## Db2 for z/OS mode (optional)

This half needs a reachable z/OS system with **Db2 for z/OS V9 or later**, ICSF,
WLM, a 3270 connection for the mainframe-side build steps, and **your own IBM
JDBC driver jars**. Everything here is optional — the site is complete in
PostgreSQL mode.

Values below are written as placeholders. Substitute your own subsystem,
location, data set names, libraries and credentials wherever the repository's
JCL and SQL contain hard-coded sample names such as `DB9G`, `DALLAS9`,
`DSN910.*`, `IBMUSER.*` or `DB9GENV1`. Those names come from a Db2 V9 system;
newer releases use different libraries and plans.

### Bring your own JDBC drivers

> [!IMPORTANT]
> **This repository does not contain the IBM Db2 JDBC drivers, and the
> maintainer cannot provide them.** They are IBM-licensed binaries that must be
> obtained by each user under their own entitlement. Do not ask for them in an
> issue, and do not commit them to a fork.

You need these two files before anything in this section will work:

| File | What it is |
| --- | --- |
| `db2jcc4.jar` | IBM Data Server Driver for JDBC and SQLJ (type 4 driver). |
| `db2jcc_license_cisuz.jar` | Licence file that enables direct z/OS connectivity without a paid Db2 Connect licence. |

Legitimate sources, depending on what you are entitled to:

- The JDBC classes shipped with your own Db2 for z/OS installation (look under
  the `/usr/lpp/db2*` product libraries on USS).
- An IBM Data Server Driver for JDBC and SQLJ / Db2 client package you
  downloaded from IBM (Fix Central, Passport Advantage, or your IBM entitlement).
- Your organisation's internal, licensed copy of the driver.

Copy **your** files into the repository (the directory is git-ignored):

```sh
mkdir -p db2/db2jdbc
cp /path/to/your/db2jcc4.jar              db2/db2jdbc/
cp /path/to/your/db2jcc_license_cisuz.jar db2/db2jdbc/
ls -l db2/db2jdbc/*.jar
```

`run-bridge.sh` expects exactly those two names at that path. If the driver
package you are entitled to ships a single combined jar instead, edit the
`CLASSPATH` in `run-bridge.sh` to match — the script currently references both
filenames.

Without them the bridge fails immediately: `javac` cannot resolve
`com.ibm.db2.jcc.*`, or the JVM throws
`ClassNotFoundException: com.ibm.db2.jcc.DB2Driver`. This is a missing-driver
problem on your side, not a bug in this project. PostgreSQL mode is unaffected.

### 1. Reach the mainframe

Older z/OS sshd builds often need legacy algorithms:

```sh
ssh -oKexAlgorithms=+diffie-hellman-group1-sha1 \
    -oHostKeyAlgorithms=+ssh-rsa \
    <user>@<zos-host>
```

You land in **z/OS UNIX System Services (USS)**. On the reference system:

- `PATH` is just `/bin`.
- `submit <file.jcl>` submits JCL to JES and prints the job id.
- There is no `tsocmd`, `db2`, `dsn` or `opercmd` on the image; use JCL that
  drives the `DSN` TSO command processor instead.
- `/usr/lpp/db2*` holds the Db2 product libraries.
- FTP on port 21 can also submit JCL through the JES reader, but `submit` from
  USS is simpler.

To stage a file and read a job's output over SSH:

```sh
ssh <user>@<zos-host> 'cat > /tmp/my.jcl' < ./my.jcl
ssh <user>@<zos-host> 'cd /tmp && submit my.jcl'
```

For non-interactive sessions, use an SSH key or an automation tool that reads
the password from an environment variable — never put a password on a command
line. Windows users can do the same from WSL2, or use PuTTY/plink.

### 2. Verify Db2 is reachable

Once the bridge is running (step 5):

```sh
curl -s http://127.0.0.1:8099/health
# {"ok":true,"connected":true,"version":"DSN09015","icsf":true,...}
```

`DSN09015` is the version string reported by Db2 V9 for z/OS. **V9 and later**
subsystems report their own strings; whatever yours returns here simply confirms
that your JDBC driver reached the right subsystem. The SQL, JCL and COBOL in this
repository target Db2 for z/OS V9 or later — adjust library, plan and
load-module names for your release.

### 3. Create the BANKAPP schema

Run `db2/sql/` in numeric order through SPUFI or DSNTEP2. The repository's
`db2/jcl/RUN-SQL.jcl` wraps DSNTEP2:

```jcl
//BANKDB   JOB (ACCT),'BANK DDL',CLASS=A,MSGCLASS=X,MSGLEVEL=(1,1)
//RUNSQL   EXEC PGM=IKJEFT01,DYNAMNBR=50
//STEPLIB  DD DSN=<db2-sdsnload>,DISP=SHR
//SYSTSPRT DD SYSOUT=*
//SYSTSIN  DD *
  DSN SYSTEM(<subsystem>)
  RUN PROGRAM(DSNTEP2) PLAN(<dsntep2-plan>) -
      LIB('<db2-runlib-load>')
  END
/*
//SYSIN    DD DSN=<hlq>.BANKAPP.SQL(DDL),DISP=SHR
```

Upload a member first, then submit:

```sh
cp db2/sql/01-create-objects.sql "//'<hlq>.BANKAPP.SQL(DDL)'"
```

Recommended order: `01-create-objects.sql`, `02-create-procedure.sql`,
`03-migrate-users.sql`, `04-verify.sql`,
`09-transactions-notifications.sql`. The numbered `05`–`08` files are
diagnostics and alternative procedure definitions — see `db2/README.md`.

Two rules from the DDL comments are worth repeating:

- `CREATE DATABASE` leaves the database **STOPPED**. Run
  `db2/jcl/START-DATABASE.jcl` (`-START DATABASE(BANKDB)`) before using it,
  or every access fails with `SQLCODE -540 / SQLSTATE 57001`.
- Do **not** add an `IN <database>.<tablespace>` clause to the tables. On Db2
  for z/OS an index needs an index table space in the same database; letting
  Db2 allocate the pair automatically avoids `-540` on tables with primary keys.

### 4. Build HASHUD (COBOL + ICSF + WLM)

This is the most delicate part; the full narrative is in `db2/README.md` and
`db2/wlm/README.md`. Short version:

1. Compile `db2/cobol/HASHUD.cbl` with `RENT`, `NODYNAM`, and APF-authorised
   libraries — see `db2/jcl/BUILD-HASHUD.jcl`.
2. Link the load module into the WLM STEPLIB library and APF-authorise that
   library (`db2/jcl/APFLINK.jcl`). APF entries added with `SETPROG APF,ADD`
   do not survive an IPL.
3. Define the WLM application environment (`db2/wlm/DB9GWLM1.proc`), make its
   JCL procedure findable in the JES2 `PROC00` concatenation, and activate the
   WLM policy. `SQLCODE -471` means this step is not done.
4. Create the external stored procedure with `db2/sql/02-create-procedure.sql`
   (or `08-hashud-final-working.sql`), then run
   `db2/jcl/REFRESH-PROCEDURE.jcl`.
5. Make sure **ICSF is started** on the console (`S ICSF`, then `D ICSF`).
   `CALL BANKAPP.HASHUD` must return `RETURN_CODE=0`.

Three correctness details documented in the COBOL and SQL sources:

- **CCSID.** Db2 hands COBOL EBCDIC; ICSF hashes the bytes it receives. The
  program converts EBCDIC 037 → national → ISO-8859-1 (819) so the digest
  matches `sha256(utf8(password))`. Without it, every existing password stops
  matching.
- **Parameter linkage.** A `VARCHAR(100)` input arrives as a 2-byte length
  prefix followed by data, so the LINKAGE SECTION declares
  `PIC S9(4) COMP` length plus `PIC X(100)`.
- **`PARAMETER CCSID EBCDIC`** on `CREATE PROCEDURE`. Without it, Db2 passes
  COBOL's EBCDIC output parameters through unconverted and JDBC fails with
  `-4220` (`CharConversionException`).

Verify the digest through the bridge:

```sh
curl -s -X POST http://127.0.0.1:8099/hash \
  -H 'Content-Type: application/json' -d '{"text":"password"}'
# {"hash":"5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8",
#  "returnCode":0,"reasonCode":0}
```

It must equal the local digest:

```sh
node -e "console.log(require('crypto').createHash('sha256').update('password').digest('hex').toUpperCase())"
```

### 5. Start the JDBC bridge

Why a bridge at all: the only client that reaches Db2 for z/OS without a paid
Db2 Connect licence is the JDBC driver. The Node `ibm_db` CLI/ODBC driver fails
with `SQL1598N` (licensing) even with correct credentials. The bridge exposes
fixed, parameterised operations only — no generic SQL endpoint.

> [!IMPORTANT]
> The bridge **cannot compile or start without your own JDBC jars** in
> `db2/db2jdbc/`. They are **not provided by this project**. Complete
> [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers) first.
> `db2/jdbc-bridge/README.md` has additional background on the bridge API.

Export the connection settings in the shell that starts the bridge, then run it:

```sh
export DB2_HOST=<zos-host>
export DB2_PORT=<drda-port>
export DB2_LOCATION=<db2-location>
export DB2_USER=<db2-user>
export DB2_PASSWORD=<db2-password>          # never put this on a command line

cd db2/jdbc-bridge
./run-bridge.sh
```

`run-bridge.sh` finds a JDK 17+, compiles `Db2Bridge.java` if the source is
newer than the class, and listens on `127.0.0.1:8099`. Override `BRIDGE_PORT`,
`BRIDGE_HOST` or `JAVA_HOME` as needed. On macOS,
`db2/jdbc-bridge/install-service.sh` installs it as a launchd service; on Linux
use an equivalent systemd unit; on Windows run it inside WSL2.

The bridge holds no long-lived connection pool — each request opens and closes
its own connection — so restarting it is safe at any time.

For diagnosis, a small standalone JDBC helper is invaluable (`sql`, `try` to
run in a transaction and roll back while printing the full `SQLException` chain,
and `meta` for column defaults/identity). Compile any such helper against the
same jars:

```sh
javac -cp db2/db2jdbc/db2jcc4.jar -d ./build Db2Admin.java
java -cp "./build:db2/db2jdbc/db2jcc4.jar:db2/db2jdbc/db2jcc_license_cisuz.jar" \
     Db2Admin sql "SELECT COUNT(*) FROM BANKAPP.TRANSACTIONS"
```

Useful catalog queries:

```sql
-- table space status: 'A' = available, 'P' = check-pending
SELECT DBNAME, NAME, STATUS FROM SYSIBM.SYSTABLESPACE
 WHERE DBNAME LIKE 'DSN%';

-- tables owned by the application schema
SELECT NAME, DBNAME, TSNAME FROM SYSIBM.SYSTABLES WHERE CREATOR='BANKAPP';

-- check constraints and indexes
SELECT CHECKNAME, CHECKCONDITION FROM SYSIBM.SYSCHECKS WHERE TBNAME='TRANSACTIONS';
SELECT NAME, UNIQUERULE, COLCOUNT FROM SYSIBM.SYSINDEXES
 WHERE TBCREATOR='BANKAPP' AND TBNAME='TRANSACTIONS';

-- registered procedures
SELECT NAME, ROUTINETYPE, LANGUAGE, EXTERNAL_NAME, PARM_COUNT
  FROM SYSIBM.SYSROUTINES WHERE NAME LIKE 'HASH%';
```

> `db2/jdbc-bridge/README.md` describes the bridge's endpoints in detail, but
> `Db2Bridge.java` is authoritative — the bridge now also serves transfers,
> transactions and notifications.

### 6. Switch the app to Db2 mode

In `.env`, uncomment and fill in the DB2 block:

```dotenv
DB2_HOST=<zos-host>
DB2_PORT=<drda-port>
DB2_LOCATION=<db2-location>
DB2_USER=<db2-user>
DB2_PASSWORD=<db2-password>
DB2_BRIDGE_URL=http://127.0.0.1:8099
```

**Restart Next.js — this is required, not optional.** Next.js loads `.env` once
at boot, so editing `DB2_HOST` has no effect until the process restarts.
Confirm:

```sh
curl -s http://localhost:3000/api/db2/status
# {"ok":true,"configured":true,"hashing":{"engine":"icsf",...}}
```

To go back to PostgreSQL, comment out `DB2_HOST` and restart.

---

## Verification checklist

Run this after any fresh setup or repair. The `curl` examples assume a real
`curl` binary; in Windows PowerShell use `curl.exe` or run them in WSL/Git Bash.

```sh
# 1. Bridge (Db2 mode only)
curl -s http://127.0.0.1:8099/health
curl -s -X POST http://127.0.0.1:8099/hash \
  -H 'Content-Type: application/json' -d '{"text":"password"}'

# 2. App
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/db2/status

# 3. Register (captures a real session cookie)
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"smoketest","email":"smoke@example.com","fullName":"Smoke Test","password":"TestPass123"}'

# 4. Reads
curl -s -b cookies.txt http://localhost:3000/api/transactions
curl -s -b cookies.txt http://localhost:3000/api/notifications

# 5. Fund the test account, then look up a payee and send money
#    PostgreSQL: UPDATE bank_accounts SET balance = 100 WHERE user_id = <id>;
#    Db2:        UPDATE BANKAPP.ACCOUNTS SET BALANCE = 100 WHERE USER_ID = <id>;
curl -s -b cookies.txt -X POST http://localhost:3000/api/recipients/lookup \
  -H 'Content-Type: application/json' -d '{"identifier":"<payee>"}'
curl -s -b cookies.txt -X POST http://localhost:3000/api/transactions/send \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: smoke-1' \
  -d '{"identifier":"<payee>","amount":"1.00","password":"TestPass123"}'
# → {"ok":true,"trxId":"200000000001","idempotencyKey":"smoke-1","duplicate":false,...}

# 6. Replay the same Idempotency-Key — the receipt comes back, nothing is charged
curl -s -b cookies.txt -X POST http://localhost:3000/api/transactions/send \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: smoke-1' \
  -d '{"identifier":"<payee>","amount":"1.00","password":"TestPass123"}'
# → {"duplicate":true,...} and the sender's balance is unchanged

# 7. Dismiss notifications, then re-read
curl -s -b cookies.txt -X POST http://localhost:3000/api/notifications/dismiss \
  -H 'Content-Type: application/json' -d '{}'
curl -s -b cookies.txt http://localhost:3000/api/notifications
```

Expected: all `200`, a new `SENT` row, one `money_sent` notification, and
`unread` dropping to `0` after dismiss. The send response must carry a 12-digit
`trxId` that also appears in `GET /api/transactions`, and the replay in step 6
must return `duplicate: true` without changing the balance. Afterwards delete
`cookies.txt`, remove the smoke-test rows, and restore any balances you changed.

---

## Day-to-day operation

```sh
# Terminal 1 — mainframe bridge (Db2 mode only)
cd db2/jdbc-bridge && ./run-bridge.sh

# Terminal 2 — web app, from the repository root
npm run dev
```

| Task | Command |
| --- | --- |
| Start PostgreSQL | `brew services start postgresql@16` (macOS) · `sudo systemctl start postgresql` (Linux) · Windows service |
| Switch to Db2 | Set `DB2_HOST` in `.env`, **restart** `npm run dev` |
| Switch to PostgreSQL | Comment out `DB2_HOST`, **restart** `npm run dev` |
| Check the bridge | `curl -s http://127.0.0.1:8099/health` |
| Check the app | `curl -s http://localhost:3000/api/health` |
| Which hash engine ran | `curl -s http://localhost:3000/api/db2/status` |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| Production build | `npm run build`, then `npm run start` |

Stop with `Ctrl-C` in each terminal.

---

## Troubleshooting

### Application gotchas

**Db2 `CHAR` columns compared against user input.** `ACCOUNT_NUMBER = ?` fails
with `SQLCODE -302 / 22001` when the parameter is longer than the column — Db2
tries to *assign* rather than simply not match. Compare as strings:
`RTRIM(A.ACCOUNT_NUMBER) = CAST(? AS VARCHAR(255))`.

**`SETPROG APF,ADD` does not survive an IPL.** The APF entry for the procedure
library is lost on every restart, and `-444` comes back. See `db2/README.md`.

**Rate-limit state is an in-process `Map`.** Correct for one server; wrong the
moment the app is scaled horizontally. Move it to Redis before replicating.

**`src/db/index.ts` throws at import time** if `DATABASE_URL` is missing, even
in Db2 mode where Drizzle is rarely used. Keep it set, and keep PostgreSQL up.

**`no PostgreSQL user name specified in startup packet`.** If `DATABASE_URL`
has no username (`postgresql://localhost:5432/app_db`), the `pg` driver falls
back to `$PGUSER`, then `$USER`. In a non-login shell (CI, an agent, a service)
both can be empty. Put the role in the URL or export `PGUSER` in the service
environment.

**Editing `.env` appears to do nothing.** Next.js reads `.env` at boot. Restart
the dev server after any change, especially to `DB2_HOST`. The bridge is a
different process and does not read `.env` at all.

### Db2 / ICSF

**`SQLCODE=-904, SQLSTATE=57011, reason 00C900A3` — unavailable resource.**
A table space is in **CHECK PENDING** (status `P` in
`SYSIBM.SYSTABLESPACE`), usually after a LOAD or an insert that violated a
constraint. `GET /api/transactions` then returns 500 and the dashboard stays on
"Transaction history: Loading…" forever — that is a symptom, not a front-end
bug: `TransactionHistory` keeps its last good state when a fetch fails.

Confirm, then start the table space with `ACCESS(FORCE)` through the `DSN` TSO
command processor (on some Db2 V9 subsystems there is no
`ADMIN_COMMAND_DSN` procedure; calling it returns `SQLCODE=-440`):

```sql
SELECT DBNAME, NAME, STATUS FROM SYSIBM.SYSTABLESPACE WHERE NAME='<tsname>';
-- ... | <tsname> | P
```

```jcl
//DB2FIX  JOB (ACCT),'DB2FIX',CLASS=A,MSGCLASS=X,MSGLEVEL=(1,1)
//CMDFIX  EXEC PGM=IKJEFT01,DYNAMNBR=50
//STEPLIB  DD DSN=<db2-sdsnload>,DISP=SHR
//SYSTSPRT DD PATH='/tmp/fix.out',PATHOPTS=(OWRONLY,OCREAT,OTRUNC)
//SYSPRINT DD SYSOUT=*
//SYSTSIN  DD *
  DSN SYSTEM(<subsystem>)
  -DISPLAY DATABASE(<dbname>) SPACENAM(<tsname>) RESTRICT
  -START DATABASE(<dbname>) SPACENAM(<tsname>) ACCESS(FORCE)
  -DISPLAY DATABASE(<dbname>) SPACENAM(<tsname>) RESTRICT
  END
/*
```

Writing `SYSTSPRT` to a USS `PATH=` lets you read the job output over SSH
without SDSF. Afterwards the status should be `A` and reads should work again.

**`ERRORCODE=-4228` "Batch failure" on a transfer.** `-4228` is generic; JDBC
wraps the real error in `getNextException()`. Re-run the failing INSERT inside a
rolled-back transaction to expose the underlying `SQLCODE`. A common cause is
schema drift (below), e.g. `SQLCODE=-545, SQLSTATE=23513` from a
`CHECK (IDEMPOTENCY_KEY IS NOT NULL)` constraint.

**`ICSF hashing failed (return code 12, reason code 0)`.** `/api/db2/status`
reports `"engine":"local"`. RC 12 means the ICSF started task is down — most
commonly after an IPL. On the 3270 console: `D ICSF`, then `S ICSF`, then
re-test `/hash`. Login still works because Node's SHA-256 is byte-identical, but
treat `"local"` as an incident, not a normal state. `/api/db2/status` caches the
*last hash result* in process memory, so make one real request (a login or a
registration) before re-reading it.

> On some locked-down images, `IKJEFT01` with the TSO `CONSOLE` command returns
> `IKJ55305I ... DOES NOT HAVE CONSOLE COMMAND AUTHORITY`. In that case operator
> commands must be issued from the 3270 console, not from a batch job.

**`SQL1598N` licensing problem.** You are using the Node `ibm_db` driver
directly against z/OS. Use the JDBC bridge instead, with **your own**
`db2jcc_license_cisuz.jar` — the freely redistributable z/OS licence file you
must obtain from IBM yourself. It is not shipped with this project.

**`ClassNotFoundException: com.ibm.db2.jcc.DB2Driver`, or `javac` cannot find
the driver classes.** The JDBC jars are missing from `db2/db2jdbc/`. This
repository does not supply them — see
[Bring your own JDBC drivers](#bring-your-own-jdbc-drivers).

**`-540`, `-471`, `-444`, `-4220`, `-330`.** See the build checklist in
[step 4](#4-build-hashud-cobol--icsf--wlm) and `db2/README.md` — these map to a
stopped database, an inactive WLM environment, a non-APF load library, a
missing `PARAMETER CCSID EBCDIC`, and the same CCSID issue via an SQL wrapper.

### Schema drift on an existing database

The committed migrations (`drizzle/*.sql`, `db2/sql/09-*.sql`,
`src/db/schema.ts`) do **not** contain `trx_id` or `idempotency_key` columns.
**Fresh installs need neither trigger below.**

If an existing database has had an additional transaction-id migration applied
(those columns `NOT NULL` with unique indexes and no defaults), inserts from the
app will fail because it does not supply them. This is schema drift, not an
application bug. Two DB-only compatibility triggers preserve the constraints
and both unique indexes; code that *does* supply the columns still works, thanks
to `COALESCE`.

**Db2 for z/OS** — `ID` is `GENERATED BY DEFAULT AS IDENTITY` and is available in
a `BEFORE` trigger; `REFERENCE` is the natural idempotency key:

```sql
CREATE TRIGGER BANKAPP.TRX_DEFKEYS
  NO CASCADE BEFORE INSERT ON BANKAPP.TRANSACTIONS
  REFERENCING NEW AS N
  FOR EACH ROW MODE DB2SQL
  WHEN (N.IDEMPOTENCY_KEY IS NULL OR N.TRX_ID IS NULL)
  BEGIN ATOMIC
    SET N.IDEMPOTENCY_KEY = COALESCE(N.IDEMPOTENCY_KEY, N.REFERENCE);
    SET N.TRX_ID = COALESCE(N.TRX_ID,
                    'LE' || DIGITS(DECIMAL(N.ID, 10, 0)));
  END
```

**PostgreSQL** — `BEFORE` triggers run before `NOT NULL` is enforced:

```sql
CREATE OR REPLACE FUNCTION bankapp_tx_default_keys() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.idempotency_key IS NULL THEN
    NEW.idempotency_key := COALESCE(NULLIF(NEW.reference, ''),
                                    gen_random_uuid()::text);
  END IF;
  IF NEW.trx_id IS NULL THEN
    NEW.trx_id := 'LE' || lpad(NEW.id::text, 10, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trx_default_keys ON transactions;
CREATE TRIGGER trx_default_keys BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION bankapp_tx_default_keys();
```

### Browser console noise

```
A tree hydrated but some attributes of the server rendered HTML didn't match
... bis_skin_checked="1" ... __processed_...="true"
unhandledRejection: TypeError: Cannot read properties of undefined (reading 'M_ID')
    at chrome-extension://...
```

Not an application bug. A browser extension is injecting attributes into the DOM
before React hydrates, and the extension's own script is throwing. Disable the
extension for `localhost`, or use a private/incognito window with extensions
off. Doing nothing is also safe — React leaves the attributes alone and the app
works.

---



## Repository layout

| Path | What |
| --- | --- |
| `src/app/` | Next.js pages and API routes |
| `src/components/` | Dashboard, auth forms, send/receive dialogs, feed provider |
| `src/lib/auth-service.ts` | Database and hashing switches |
| `src/lib/transfer-service.ts` | Money movement, both databases |
| `src/lib/db2.ts` | Mainframe access over the bridge |
| `src/lib/session.ts`, `hash.ts`, `rate-limit.ts` | Sessions, digests, token buckets |
| `src/lib/feed-service.ts`, `feed-events.ts` | Dashboard snapshot and change bus |
| `src/db/schema.ts` | Drizzle schema for the PostgreSQL mirror |
| `drizzle/*.sql` | PostgreSQL migrations |
| `db2/sql/` | Db2 DDL in numbered order (`01` … `09`) |
| `db2/cobol/` | `HASHUD.cbl` (ICSF SHA-256) and diagnostic helpers |
| `db2/jcl/` | JCL to build/link/refresh the procedure and run SQL |
| `db2/wlm/` | WLM address-space proc for the external stored procedure |
| `db2/java/` | Standalone JDBC / hashing diagnostics |
| `db2/jdbc-bridge/` | Java 17 HTTP bridge (`Db2Bridge.java`) and launch scripts |
| `db2/db2jdbc/` | **You supply these — not committed, not provided** — `db2jcc4.jar` + `db2jcc_license_cisuz.jar` |
| `.env.example` | Template for all environment variables |
| `scripts/publish.sh` | Helper that created and pushed the repository |

## Not committed

`.env`, `node_modules/`, `.next/`, `*.class`, and the **IBM JDBC jars**.

