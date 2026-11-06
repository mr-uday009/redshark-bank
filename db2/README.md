# Db2 for z/OS — BANKAPP, HASHUD and the JDBC bridge

This folder holds every mainframe-side artefact needed to move Redshark Bank off
the local PostgreSQL mirror and onto **Db2 for z/OS**, with password hashing
performed on the mainframe by **ICSF** (SHA-256 via `CSNBOWH`) inside a
**WLM-managed external COBOL stored procedure**.

For installing the web app, creating the PostgreSQL database and configuring
`.env`, see the [root README](../README.md). This document covers only the Db2
side.

> [!IMPORTANT]
> **Bring your own IBM Db2 JDBC drivers.** This repository does **not** provide
> `db2jcc4.jar` or `db2jcc_license_cisuz.jar`. They are IBM-licensed binaries
> you must obtain yourself and place in `db2/db2jdbc/` before the bridge will
> compile or start. See [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers).
> Requests to have the jars added or sent will be declined.

> [!IMPORTANT]
> **Supported version: Db2 for z/OS V9 or later** (V9, V10, V11, V12, V13 …).
> The SQL, JCL and COBOL here were authored against a **V9** subsystem. Every
> subsystem name, location, plan name, load library and data set prefix below is
> an **example from that V9 system** — substitute the values for your own
> release before running anything.

---

## Contents

- [Reference environment](#reference-environment)
- [Data flow](#data-flow)
- [Setup order](#setup-order)
- [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers)
- [COBOL, CCSID and ICSF details](#cobol-ccsid-and-icsf-details)
- [Error-code reference](#error-code-reference)
- [Files in this folder](#files-in-this-folder)
- [Verification](#verification)
- [Caveats before you start](#caveats-before-you-start)

---

## Reference environment

These are the values the committed scripts were written against. Treat the
right-hand column as a template, not as a requirement.

| Item | Example from a V9 system | Your value |
| --- | --- | --- |
| Db2 version | V9 for z/OS, version string `DSN09015` | V9 **or later**; your own version string |
| Host | `<zos-host>` | — |
| Access | SSH / FTP / TSO-telnet as `<db2-user>` | — |
| Db2 subsystem | `DB9G` | `<subsystem>` |
| Db2 location | `DALLAS9` (DRDA port `5025`) | `<db2-location>`, `<drda-port>` |
| COBOL compiler | Enterprise COBOL 4.2 (`IGY420.SIGYCOMP`) | your compiler library |
| LE runtime / link-edit | `CEE.SCEERUN`, `CEE.SCEELKED` | your LE libraries |
| ICSF modules | `CSF.SCSFMOD0` (in the LNKLST on the reference system) | your ICSF library |
| Db2 load library | `DSN910.DB9G.RUNLIB.LOAD` | `<db2-runlib-load>` |
| WLM application environment | `DB9GENV1` (procedure `DB9GWLM1`) | `<wlm-env>` |
| HASHUD source member | `<hlq>.COBOL(HASHUD)` | your source PDS |
| DSNTEP2 plan | `DSNTEP91` | the plan for your release |

`DSN910.*`, `DSNTEP91`, `DB9G` and `DALLAS9` are **V9-era names**. Newer releases
ship different libraries and plan names — check your own subsystem's SDSNLOAD,
RUNLIB and DSNTEP2 plan before submitting the JCL.

---

## Data flow

```
browser
   |  HTTPS  (plaintext password, never stored)
   v
Next.js API route  /api/auth/register | /api/auth/login
   |  local HTTP -> JDBC bridge :8099
   v
jdbc:db2://<zos-host>:<drda-port>/<db2-location>
   |
Db2 for z/OS  ---- CALL BANKAPP.HASHUD(?,?,?,?) ---->  WLM application env <wlm-env>
                                                          |
                                                          v  load module HASHUD
                                                     (WLM STEPLIB, APF-authorised)
                                                          |
                                                          v  CALL 'CSNBOWH'
                                                     ICSF SHA-256
                                                          |
   <----- 64-char uppercase hex digest -------------------
   |
   v
INSERT/SELECT BANKAPP.USERS  (PASSWORD_HASH CHAR(64))
```

The app reaches Db2 **only** through the JDBC bridge. The Node `ibm_db`
CLI/ODBC driver cannot connect to z/OS without a paid Db2 Connect licence and
fails with `SQL1598N` even with correct credentials — see
[Why a JDBC bridge](#why-a-jdbc-bridge).

---

## Setup order

Work through these in order. Steps 1–7 are mainframe-side; step 8 is on your
workstation.

### 1. Obtain the JDBC drivers

Do this first — it is a prerequisite for the bridge, not an afterthought. See
[Bring your own JDBC drivers](#bring-your-own-jdbc-drivers).

### 2. Create the Db2 objects

Run `sql/01-create-objects.sql` (database, `BANKAPP.USERS`,
`BANKAPP.ACCOUNTS`, indexes), **then `sql/09-transactions-notifications.sql`**
(`BANKAPP.TRANSACTIONS`, `BANKAPP.NOTIFICATIONS`). The second file is easy to
miss: without it, transfers, transaction history and notifications all fail.

Three rules that the DDL comments encode:

- **`CREATE DATABASE` leaves the database STOPPED.** `CREATE TABLE` succeeds
  (catalog only) but every later `INSERT`/`SELECT` returns
  `SQLCODE -540, SQLSTATE 57001`. Run `jcl/START-DATABASE.jcl`:

  ```
  DSN SYSTEM(<subsystem>)
  -START DATABASE(BANKDB)
  -DISPLAY DATABASE(BANKDB) SPACENAM(<tsname>)
  END
  ```

- **Do not put the tables in a hand-made table space.** If a table is created
  `IN <database>.<tablespace>` and that table space has no companion **index**
  table space in the same database, every table with a PRIMARY KEY or unique
  index becomes unusable (`-540`). A single segmented table space cannot host
  both tables and indexes. Omit the `IN` clause — `01-create-objects.sql`
  already does — and Db2 allocates the matching pair automatically.

- **Run SQL in numbered order** through SPUFI or DSNTEP2.
  `jcl/RUN-SQL.jcl` is the DSNTEP2 template; substitute your subsystem, plan
  and load library names.

Recommended order: `01` → `02` (or `08`, see step 6) → `03` → `04` → `09`.
Files `05`–`07` are diagnostics and alternative definitions, not part of a
clean install.

### 3. Build HASHUD

Compile `cobol/HASHUD.cbl` reentrant (`RENT`, `NODYNAM`) and link-edit the load
module `HASHUD` into a library that is in the **STEPLIB of the WLM stored-procedure
address space**:

- `jcl/BUILD-HASHUD.jcl` — compile + link-edit.
- `jcl/APFLINK.jcl` — link into an APF-authorised, linklisted library with
  `AC=1`, which avoids `-444` without needing a `SETPROG APF,ADD` entry.

The WLM address space runs APF-authorised, so a module from a non-APF library
cannot be loaded (`SQLCODE -444`). Either authorise the STEPLIB library
(`SETPROG APF,ADD,DSNAME=<library>,VOLUME=<volser>`) or use the APF-linklist
approach in `APFLINK.jcl`. **APF entries added with `SETPROG` do not survive an
IPL** — make the authorisation permanent in `PROGxx` for anything but a lab.

### 4. Make the WLM environment usable

Three things must line up before `CALL BANKAPP.HASHUD(...)` works (details in
[wlm/README.md](wlm/README.md)):

1. An application environment of subsystem type **DB2** exists in the **active**
   WLM service definition.
2. Its JCL procedure is findable in the **JES2 `PROC00`** concatenation — copy
   `wlm/DB9GWLM1.proc` into a proclib that is concatenated, or add the Db2
   proclib permanently.
3. The `HASHUD` load module is in that procedure's **STEPLIB**.

`SQLCODE -471 / SQLSTATE 55023` means this step is not done. A useful
confirmation is that `SYSIBM.SQLTABLES` (IBM's own JDBC support procedure)
starts returning a result set once the WLM policy is active.

### 5. Start ICSF

On the 3270 console: `D ICSF`, then `S ICSF` if it is stopped. `CSNBOWH` lives
in `CSF.SCSFMOD0`; if that library is not in the LNKLST on your system, add it
to the WLM procedure's STEPLIB.

`CALL BANKAPP.HASHUD` returning `RETURN_CODE=12` almost always means the ICSF
started task is down (commonly after an IPL). The web app then falls back to
Node's SHA-256 and reports `"engine":"local"` in `/api/db2/status` — treat that
as an incident, not a normal state.

### 6. Register the procedure — use `08`, not `02`

> [!WARNING]
> **`sql/02-create-procedure.sql` predates the CCSID fix and is missing
> `PARAMETER CCSID EBCDIC`.** Running it as-is produces
> `SQLCODE -4220` over JDBC (`-330` through an SQL wrapper) on every call.
> Use **`sql/08-hashud-final-working.sql`** as the authoritative definition, or
> add the one missing line to `02` yourself. See
> [COBOL, CCSID and ICSF details](#cobol-ccsid-and-icsf-details).

The working definition is:

```sql
CREATE PROCEDURE BANKAPP.HASHUD
    (IN  PLAIN_TEXT     VARCHAR(100),
     OUT HASH_OUT       CHAR(64),
     OUT RETURN_CODE    INTEGER,
     OUT REASON_CODE    INTEGER)
    LANGUAGE COBOL
    PARAMETER STYLE GENERAL
    PARAMETER CCSID EBCDIC          -- the line that fixes -4220 / -330
    EXTERNAL NAME HASHUD
    WLM ENVIRONMENT <wlm-env>
    COMMIT ON RETURN YES
    NO SQL;

GRANT EXECUTE ON PROCEDURE BANKAPP.HASHUD TO PUBLIC;
```

Substitute `WLM ENVIRONMENT` with the application environment you activated in
step 4 — `08` contains the reference system's `DB9GENV1`. On a fresh system,
`08` starts with `DROP PROCEDURE BANKAPP.HASHUD`, which fails if the procedure
does not exist yet; run `02` first or remove the `DROP`.

Then run `jcl/REFRESH-PROCEDURE.jcl` (`-STOP PROCEDURE`, `-START PROCEDURE`,
`-DISPLAY PROCEDURE`) so the WLM address space picks up the new load module.

### 7. Migrate existing rows (optional)

`sql/03-migrate-users.sql` copies example rows from the PostgreSQL mirror into
`BANKAPP.USERS` / `BANKAPP.ACCOUNTS` with their SHA-256 hashes intact. **Edit
the file before running it** — it contains hard-coded example users, addresses,
account numbers, balances and timestamps, and uses explicit IDs. It is a
template, not a generic migration. On a clean install, skip it and register
users through the app instead.

### 8. Connect the website

On your workstation, start the bridge and the app in separate terminals:

```sh
# Terminal 1 — supply the connection settings in the shell (the bridge does
# NOT read .env)
export DB2_HOST=<zos-host>
export DB2_PORT=<drda-port>
export DB2_LOCATION=<db2-location>
export DB2_USER=<db2-user>
export DB2_PASSWORD=<db2-password>
cd db2/jdbc-bridge && ./run-bridge.sh      # listens on 127.0.0.1:8099

# Terminal 2 — from the repository root
npm run dev
```

In `.env` (used by Next.js, **not** by the bridge):

```dotenv
DB2_HOST=<zos-host>
DB2_PORT=<drda-port>
DB2_LOCATION=<db2-location>
DB2_USER=<db2-user>
DB2_PASSWORD=<db2-password>
DB2_BRIDGE_URL=http://127.0.0.1:8099
```

`DB2_HOST` is the mode switch; **restart Next.js after changing it** because
`.env` is read once at boot. Keep `DATABASE_URL` and PostgreSQL running in both
modes — `/api/health` always queries PostgreSQL. Unset `DB2_HOST` to fall back
to the mirror. Full configuration details are in the
[root README](../README.md#configuration-reference).

### Why a JDBC bridge

The Node `ibm_db` driver (IBM CLI/ODBC) cannot connect to z/OS without a paid
**Db2 Connect** licence — it fails with `SQL1598N ... licensing problem` even
with correct credentials. The JDBC driver has no such restriction:
`db2jcc4.jar` plus the z/OS licence jar `db2jcc_license_cisuz.jar` connect
directly. **You must obtain both jars yourself — neither is provided by this
repository.** See [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers).
Hence the bridge — a small Java process that owns the JDBC connection and
exposes fixed, parameterised operations (no generic SQL endpoint) over loopback
HTTP.

---

## Bring your own JDBC drivers

> [!IMPORTANT]
> **This repository does not contain, bundle, mirror or ship the IBM Db2 JDBC
> drivers, and the maintainer cannot provide them.** They are IBM-licensed
> binaries that each user must obtain under their own entitlement. Do not open
> issues asking for the jars, and do not commit them to a fork.

You need these two files before any Db2-mode step will work:

| File | What it is |
| --- | --- |
| `db2jcc4.jar` | IBM Data Server Driver for JDBC and SQLJ (type 4 driver). |
| `db2jcc_license_cisuz.jar` | Licence file enabling direct z/OS connectivity without a paid Db2 Connect licence. |

Legitimate sources:

- The JDBC classes shipped with your own Db2 for z/OS installation (look under
  `/usr/lpp/db2*` on USS).
- An IBM Data Server Driver for JDBC and SQLJ / Db2 client package downloaded
  from IBM under your entitlement (Fix Central, Passport Advantage).
- Your organisation's internal, licensed copy.

Copy **your** files into the git-ignored directory:

```sh
mkdir -p db2/db2jdbc
cp /path/to/your/db2jcc4.jar              db2/db2jdbc/
cp /path/to/your/db2jcc_license_cisuz.jar db2/db2jdbc/
ls -l db2/db2jdbc/*.jar
```

`run-bridge.sh` and `start.sh` expect exactly those names at that path. If the
package you are entitled to ships a single combined jar, edit the `CLASSPATH` in
those scripts accordingly. Use a driver version supported by your Db2 release:
a much newer JCC driver may not authenticate against a V9 subsystem at all.

Missing jars produce `ClassNotFoundException: com.ibm.db2.jcc.DB2Driver`, a
`javac` error resolving `com.ibm.db2.jcc.*`, or an immediate exit from
`start.sh`. That is a missing-driver problem on your side, not a project bug.
PostgreSQL mode is unaffected.

---

## COBOL, CCSID and ICSF details

These three details are where most of the debugging time goes. All are already
handled in `cobol/HASHUD.cbl` and `sql/08-hashud-final-working.sql`.

### 1. VARCHAR parameters in a COBOL stored procedure

Db2 passes a `VARCHAR(n)` parameter to COBOL as a **2-byte binary length prefix
followed by n bytes of data**:

```cobol
01  LS-INPUT-TEXT.
    05 LS-INPUT-TEXT-LEN   PIC S9(4) COMP.
    05 LS-INPUT-TEXT-DATA  PIC X(100).
```

Declaring a flat `PIC X(100)` loses the length; recovering it with
`FUNCTION STORED-CHAR-LENGTH` is rejected by older Enterprise COBOL compilers
(`IGYPS2130-S`) and truncates trailing data. `HASHUD.cbl` uses the length
prefix. (`sql/06-*.sql` and `cobol/HASHCN2.cbl` explore a `CHAR(100)` variant —
it is diagnostic, **not** the working configuration.)

### 2. The EBCDIC / ASCII trap

ICSF hashes whatever bytes it is handed, and Db2 hands a COBOL program EBCDIC.
Hashing those bytes directly produces a digest of the **EBCDIC** text:

```
ICSF('password' as EBCDIC) = 61E9F866F42264B13170F6C91BECA68C559E9C409328E695D4B13356526CD0F1
SHA-256('password' ASCII)  = 5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8
```

Every other tier — browser, Node `crypto`, the PostgreSQL mirror, and any hashes
already stored in `BANKAPP.USERS` — uses ASCII/UTF-8 bytes. Shipping the EBCDIC
digest would lock out every existing user the moment ICSF started working.
`HASHUD.cbl` converts before hashing:

```cobol
MOVE FUNCTION NATIONAL-OF(WS-EBCDIC-TEXT, 037) TO WS-NATIONAL-TEXT
MOVE FUNCTION DISPLAY-OF(WS-NATIONAL-TEXT, 819) TO WS-ASCII-TEXT
```

EBCDIC 037 → national → ISO-8859-1 (819), which is byte-identical to UTF-8 for
any realistic password.

### 3. `-4220` / `-330` — the missing `PARAMETER CCSID EBCDIC`

`CALL BANKAPP.HASHUD(...)` fails with `SQLCODE -4220`
(`CharConversionException`) over JDBC and `-330` through an SQL wrapper. The fix
is one line in `CREATE PROCEDURE`: `PARAMETER CCSID EBCDIC`.

A COBOL program writes EBCDIC into its output parameters. Without
`PARAMETER CCSID`, Db2 does not know that, so it passes the EBCDIC bytes
straight through instead of converting them; the client then tries to decode
`0xC1 0xC2 …` as UTF-8 and throws. Measured with the **same load module**:

| `PARAMETER CCSID` | Result |
| --- | --- |
| *(omitted)* | `SQLCODE -4220` |
| `EBCDIC` | **correct digest** |
| `ASCII` | wrong characters |
| `UNICODE` | `SQLCODE -4220` |

**How it was isolated.** `cobol/HASHCONST.cbl` is a diagnostic twin: identical
Db2 linkage, but it returns a fixed constant and never calls ICSF.

| Procedure | Kind | Result |
| --- | --- | --- |
| `TRIVIAL_CALL` | SQL proc, IN param, result set | works |
| `TESTOUT` | SQL proc, VARCHAR IN + CHAR(64)/INT OUT | works |
| `HASHCONST` | external COBOL, returns a constant | `-4220` |
| `HASHUD` | external COBOL, real ICSF | `-4220` |

That exonerated ICSF (HASHCONST never touches it) and OUT parameters (TESTOUT
round-trips them), leaving the external-procedure boundary where the CCSID
turned out to be the answer.

Things that were tried and **did not** fix it — skip them: JVM
`file.encoding`, `ccsid=` and `retrieveMessagesFromServerOnGetMessage` URL
properties, `executeUpdate()` vs `execute()`, `Types.CHAR` vs `Types.VARCHAR`,
dropping `COMMIT ON RETURN YES`, switching the input to `CHAR(100)`, a much
newer JCC driver, and `PARAMETER CCSID ASCII`/`UNICODE`. APF authorisation and
the WLM policy fix **different, real** problems (`-444` and `-471`) but not this
one.

---

## Error-code reference

| Code | Meaning | Where to look |
| --- | --- | --- |
| `-540 / 57001` | Database stopped, or table space has no companion index table space | [Setup step 2](#2-create-the-db2-objects) |
| `-471 / 55023` | WLM application environment not active / procedure not findable | [Setup step 4](#4-make-the-wlm-environment-usable), [wlm/README.md](wlm/README.md) |
| `-444` | Load library not APF-authorised | [Setup step 3](#3-build-hashud), `APFLINK.jcl` |
| `-4220`, `-330` | Missing `PARAMETER CCSID EBCDIC` | [CCSID details](#3--4220---330--the-missing-parameter-ccsid-ebcdic) |
| `-904 / 57011`, reason `00C900A3` | Table space in CHECK PENDING (`STATUS='P'`) | `-START DATABASE(<dbname>) SPACENAM(<tsname>) ACCESS(FORCE)` via the DSN command processor |
| `-4228` "Batch failure" | Generic JDBC wrapper; the real error is in `getNextException()` | Often `-545 / 23513` from a check constraint or schema drift |
| `-302 / 22001` | `CHAR` column compared with a longer parameter | Compare as strings: `RTRIM(A.ACCOUNT_NUMBER) = CAST(? AS VARCHAR(255))` |
| `-440` | `ADMIN_COMMAND_DSN` unavailable on some V9 subsystems | Issue Db2 commands through `DSN` in `IKJEFT01` instead |
| `RETURN_CODE=12` | ICSF started task down | [Setup step 5](#5-start-icsf) |
| `SQL1598N` | `ibm_db` CLI/ODBC lacks a Db2 Connect licence | Use the JDBC bridge |

For CHECK PENDING, `SYSTSPRT DD PATH='/tmp/fix.out',PATHOPTS=(OWRONLY,OCREAT,OTRUNC)`
lets you read the job's output over SSH without SDSF. On some locked-down images
the TSO `CONSOLE` command from `IKJEFT01` returns
`IKJ55305I ... DOES NOT HAVE CONSOLE COMMAND AUTHORITY`; issue operator commands
from the 3270 console instead.

---

## Files in this folder

| File | Purpose |
| --- | --- |
| `README.md` | This document |
| `sql/01-create-objects.sql` | `BANKDB` + `BANKAPP.USERS` / `BANKAPP.ACCOUNTS` + indexes |
| `sql/02-create-procedure.sql` | Original `BANKAPP.HASHUD` registration — **missing `PARAMETER CCSID EBCDIC`** |
| `sql/03-migrate-users.sql` | Example row migration (edit before running) |
| `sql/04-verify.sql` | Catalog checks + a `CALL` with the expected digest |
| `sql/05-call-from-spufi.sql` | SPUFI wrapper for calling the procedure |
| `sql/06-recreate-hashud-char-input.sql` | Diagnostic `CHAR(100)` input variant |
| `sql/07-hashconst-char-input.sql` | Diagnostic twin `BANKAPP.HASHCONST` |
| `sql/08-hashud-final-working.sql` | **Authoritative** `CREATE PROCEDURE` (includes the CCSID fix) |
| `sql/09-transactions-notifications.sql` | `BANKAPP.TRANSACTIONS` + `BANKAPP.NOTIFICATIONS` — required for transfers |
| `cobol/HASHUD.cbl` | ICSF SHA-256 routine, corrected for Db2 linkage and EBCDIC conversion |
| `cobol/HASHCN2.cbl`, `HASHCN3.cbl` | `CHAR(100)` diagnostic variants |
| `cobol/HASHCONST.cbl` | Constant-returning diagnostic twin |
| `cobol/HASHDRV.cbl` | Batch driver for calling `HASHUD` without Db2 |
| `jcl/BUILD-HASHUD.jcl` | Compile + link-edit `HASHUD` into the WLM load libraries |
| `jcl/BUILD-HASHCONST.jcl`, `BUILD-HASHDRV.jcl` | Build the diagnostic programs |
| `jcl/APFLINK.jcl` | Link into an APF-authorised, linklisted library (`AC=1`) |
| `jcl/START-DATABASE.jcl` | `-START DATABASE(BANKDB)` via the Db2 command processor |
| `jcl/RUN-SQL.jcl` | DSNTEP2 template for running `sql/*.sql` in batch |
| `jcl/REFRESH-PROCEDURE.jcl` | `-STOP` / `-START` / `-DISPLAY PROCEDURE(BANKAPP.HASHUD)` |
| `jcl/DISPLAY-PROCEDURE.jcl` | Show procedure registration state |
| `wlm/DB9GWLM1.proc` | WLM stored-procedure JCL, ready to drop into a proclib |
| `wlm/README.md` | WLM application-environment setup |
| `java/Db2Test.java` | Standalone JDBC connectivity smoke test |
| `java/HashDiag.java` | ICSF/hash diagnostics |
| `jdbc-bridge/Db2Bridge.java` | HTTP service that owns the JDBC connection |
| `jdbc-bridge/run-bridge.sh` | Compiles if needed, then starts the bridge |
| `jdbc-bridge/start.sh` | Launchd helper; also safe to run by hand |
| `jdbc-bridge/install-service.sh` | macOS launchd agent installer (use a systemd unit on Linux, WSL2 on Windows) |
| `jdbc-bridge/README.md` | Bridge background and API notes |
| `db2jdbc/` | **You supply `db2jcc4.jar` and `db2jcc_license_cisuz.jar` — not committed** |

> `jdbc-bridge/README.md` lists a smaller set of endpoints than the current
> `Db2Bridge.java`, which also serves transfers, transactions and
> notifications. Treat the Java source as authoritative.

---

## Verification

A clean setup should satisfy all of these:

```sql
-- Tables exist and are usable (STATUS 'A' or blank)
SELECT NAME, STATUS, DBNAME, TSNAME FROM SYSIBM.SYSTABLES WHERE CREATOR='BANKAPP';

-- Procedure registered with the right external name and WLM environment
SELECT NAME, EXTERNAL_NAME, LANGUAGE, WLM_ENVIRONMENT, PARM_COUNT
  FROM SYSIBM.SYSROUTINES WHERE NAME='HASHUD';

-- Expected digest for 'password'
CALL BANKAPP.HASHUD('password', ?, ?, ?);
```

The digest must be
`5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8` with
`RETURN_CODE=0` and `REASON_CODE=0`. Other known-good vectors:

```
'test'      -> 9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08
'Test User' -> 9E95A89B42F1FB5A3EA9F8657EC45354A080B57B8EF2F6DF85B73ADD1F756465
```

All must equal `sha256(text.encode('utf-8')).hexdigest()` in any language.

From the workstation:

```sh
curl -s http://127.0.0.1:8099/health
curl -s -X POST http://127.0.0.1:8099/hash \
  -H 'Content-Type: application/json' -d '{"text":"password"}'
curl -s http://localhost:3000/api/db2/status
```

`/api/db2/status` should report `"engine":"icsf"` with `lastError:null` after one
real login or registration (it caches the most recent hash result). The full
end-to-end smoke test — register, login, transfer, notifications — is in the
[root README](../README.md#verification-checklist).

---

## Caveats before you start

- **Example data.** `sql/03-migrate-users.sql` contains hard-coded example
  users, email addresses, account numbers, balances and password hashes. Edit
  or replace it before running against any system you care about.
- **Hard-coded names.** Every JCL member and most SQL files reference the V9
  reference system's subsystem, libraries, high-level qualifiers and WLM
  environment. Review and substitute before submitting.
- **credentials.** The sample values in `.env.example` and the defaults in
  `run-bridge.sh` come from an ADCD lab LPAR. Never reuse them; keep real
  credentials in a git-ignored `.env` and in the bridge's shell environment.
- **ICSF after IPL.** The ICSF started task is commonly down after a restart;
  check RC 12 and `/api/db2/status` before assuming a code bug.
- **JDBC jars are yours.** Nothing in this repository supplies them. See
  [Bring your own JDBC drivers](#bring-your-own-jdbc-drivers).
