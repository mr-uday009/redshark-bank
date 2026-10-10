# Sentinel Trust Bank — migrating from PostgreSQL to Db2 for z/OS with ICSF hashing

This folder holds every mainframe-side artefact needed to move the website off
the local PostgreSQL mirror and onto **Db2 for z/OS**, with **all password
hashing performed on the mainframe by ICSF** (SHA-256 via `CSNBOWH`), invoked
through a **WLM-managed stored procedure**.

---

## 1. What the target environment actually is

Everything below was verified against the live system.

| Item | Value |
| ---- | ----- |
| Host | `ADCD.DFW.IBM.COM` (192.168.200.150) |
| Access | SSH / FTP / TSO-telnet as `IBMUSER` |
| Db2 | **Db2 9.1 for z/OS**, function level `DSN09015` |
| Db2 subsystem | **`DB9G`** |
| Db2 location | **`DALLAS9`** (DRDA port 5025) |
| COBOL compiler | `IGY420.SIGYCOMP` (Enterprise COBOL 4.2) |
| LE runtime / link-edit | `CEE.SCEERUN`, `CEE.SCEELKED` |
| ICSF modules | `CSF.SCSFMOD0` — **already in the LNKLST** |
| Db2 load library | `DSN910.DB9G.RUNLIB.LOAD` |
| WLM app environment | `DB9GENV1` (procedure `DB9GWLM1`) |
| Source of HASHUD | `IBMUSER.HDFC.ICSF(HASHUD)` |

---

## 2. The plan

```
browser
   |  HTTPS  (plaintext password, never stored)
   v
Next.js API route  /api/auth/register | /api/auth/login
   |  ibm_db  (or JDBC bridge)  DATABASE=DALLAS9;HOSTNAME=...;PORT=5025
   v
Db2 for z/OS  ---- CALL BANKAPP.HASHUD(?,?,?,?) ---->  WLM application env DB9GENV1
                                                             |
                                                             v  load module HASHUD
                                                        (IBMUSER.HDFC.LOAD)
                                                             |
                                                             v  CALL 'CSNBOWH'
                                                        ICSF SHA-256
                                                             |
   <----- 64-char uppercase hex digest ----------------------
   |
   v
INSERT/SELECT BANKAPP.USERS  (PASSWORD_HASH CHAR(64))
```

Steps:

1. **Create the Db2 objects** — `sql/01-create-objects.sql`.
   `BANKDB` database, `BANKAPP.USERS` and `BANKAPP.ACCOUNTS`, matching the
   existing `users` schema (`id, username, email, full_name, password_hash,
   created_at`).
2. **Start the database** — `jcl/START-DATABASE.jcl`.
   `CREATE DATABASE` leaves it `STOPPED`; until you `-START DATABASE(BANKDB)`
   every access fails with `-540`.
3. **Build the hashing routine** — `jcl/BUILD-HASHUD.jcl`.
   Compiles `cobol/HASHUD.cbl` (reentrant) and link-edits load module
   `HASHUD` into `IBMUSER.HDFC.LOAD` **and** into the WLM STEPLIB library
   `DSN910.DB9G.RUNLIB.LOAD`.
4. **Make the WLM environment usable** — `wlm/README.md`.
   Copy `DB9GWLM1` into `USER.PROCLIB` so JES2 can find it.
5. **Register the procedure** — `sql/02-create-procedure.sql`.
   `BANKAPP.HASHUD`, `LANGUAGE COBOL`, `PARAMETER STYLE GENERAL`,
   `EXTERNAL NAME HASHUD`, `WLM ENVIRONMENT DB9GENV1`, `NO SQL`.
6. **Migrate the existing rows** — `sql/03-migrate-users.sql`.
   The two PostgreSQL rows move across with their SHA-256 hashes intact.
7. **Point the website at Db2** — set the `DB2_*` variables (section 5).

---

## 3. Two Db2 for z/OS gotchas found the hard way

### 3.1 `CREATE DATABASE` leaves the database STOPPED

A freshly created database is stopped. `CREATE TABLE` succeeds (it is catalog
only) but every later `INSERT`/`SELECT` returns
`SQLCODE -540, SQLSTATE 57001, SQLERRMC <table>`.

```
DSN SYSTEM(DB9G)
-START DATABASE(BANKDB)
-DISPLAY DATABASE(BANKDB) SPACENAM(BANKTS)
END
```

### 3.2 Do not put the tables in a hand-made table space

If the tables are created with `IN BANKDB.BANKTS` and that table space has no
**companion index table space in the same database**, then every table that has
a `PRIMARY KEY` or a unique index becomes unusable (`-540` on `INSERT`/`SELECT`).
A single segmented table space cannot host both tables and indexes.

Omit the `IN` clause and Db2 allocates a matching table space **and** index
table space automatically. That is what `sql/01-create-objects.sql` does.

### 3.3 `VARCHAR` parameters in a COBOL stored procedure

Db2 passes a `VARCHAR(n)` parameter to COBOL as a **2-byte binary length
followed by n bytes of data**:

```cobol
01  LS-INPUT-TEXT.
    05 LS-INPUT-TEXT-LEN   PIC S9(4) COMP.
    05 LS-INPUT-TEXT-DATA  PIC X(100).
```

The original `HASHUD` declared a flat `PIC X(100)` and recovered the length with
`FUNCTION STORED-CHAR-LENGTH`, which Enterprise COBOL 4.2 rejects
(`IGYPS2130-S`) and which loses trailing data. `cobol/HASHUD.cbl` here uses the
length prefix instead.

---

## 4. Files

| File | Purpose |
| ---- | ------- |
| `cobol/HASHUD.cbl` | ICSF SHA-256 hashing routine, corrected for Db2 COBOL linkage and reentrant (`RENT`) |
| `sql/01-create-objects.sql` | `BANKDB` database + `BANKAPP.USERS` / `BANKAPP.ACCOUNTS` + indexes |
| `sql/02-create-procedure.sql` | Registers `BANKAPP.HASHUD` and grants EXECUTE |
| `sql/03-migrate-users.sql` | Moves the two existing PostgreSQL rows into Db2 |
| `sql/04-verify.sql` | Status checks + a `CALL` with the expected digest |
| `jcl/BUILD-HASHUD.jcl` | Compile + link-edit `HASHUD` into both load libraries |
| `jcl/START-DATABASE.jcl` | `-START DATABASE(BANKDB)` via the Db2 command processor |
| `jcl/RUN-SQL.jcl` | Template for running any `sql/*.sql` in batch (DSNTEP2) |
| `wlm/DB9GWLM1.proc` | The WLM stored-procedure JCL, ready to drop into `USER.PROCLIB` |
| `wlm/README.md` | WLM application-environment setup, including how to define `WLMENV1` |
| `jdbc-bridge/Db2Bridge.java` | HTTP service that owns the JDBC connection the Node site uses |
| `jdbc-bridge/run-bridge.sh` | Compiles (if needed) and starts the bridge |
| `jdbc-bridge/README.md` | Bridge API reference |
| `db2jdbc/db2jcc4.jar`, `db2jdbc/db2jcc_license_cisuz.jar` | JDBC driver + free z/OS licence |
| `java/Db2Test.java` | Standalone JDBC connectivity smoke test |

---

## 5. Connecting the website

The site is Node/Next.js and talks to Db2 through a small local **JDBC bridge**
(`jdbc-bridge/Db2Bridge.java`). See `jdbc-bridge/README.md` for the API.

```sh
cd db2/jdbc-bridge && ./run-bridge.sh     # listens on 127.0.0.1:8099
npm run dev                                # in another terminal, from the repo root
```

`.env`:

```
DB2_HOST=192.168.200.150
DB2_PORT=5025
DB2_LOCATION=DALLAS9
DB2_USER=IBMUSER
DB2_PASSWORD=<your password>
DB2_BRIDGE_URL=http://127.0.0.1:8099
```

The ADCD sample system ships with `IBMUSER` / `SYS1`; set `DB2_PASSWORD` to
whatever your LPAR actually uses. `.env` is git-ignored — never commit it.

Unset `DB2_HOST` and the site falls back to the PostgreSQL mirror.

### Why JDBC and not `ibm_db`

The Node `ibm_db` driver (IBM CLI/ODBC) **cannot** connect to z/OS without a
paid Db2 Connect licence — it fails with `SQL1598N ... licensing problem` even
when the credentials are correct. Verified both ways against this host.

The JDBC driver has no such restriction: `db2jcc4.jar` + the freely
redistributable `db2jcc_license_cisuz.jar` (both in `db2jdbc/`) connect
immediately. Hence the bridge.

### Host address

The reachable host is **192.168.200.150**. The `192.168.100.150` in the older
notes does not respond (100% packet loss) — that value is stale.

### Verified end to end

```
POST /api/auth/register  -> creates the user in BANKAPP.USERS (z/OS)
POST /api/auth/login     -> reads BANKAPP.USERS (z/OS), verifies the digest
GET  /                   -> dashboard shows the real account from BANKAPP.ACCOUNTS
```

The opening account is created in `BANKAPP.ACCOUNTS` at registration, matching
the PostgreSQL behaviour.

> **Hashing engine.** `GET /api/db2/status` reports which engine hashed the most
> recent password. It now reads `"engine":"icsf"` — the password is hashed by
> ICSF on the mainframe and the plaintext never leaves the web tier. The site
> still falls back to Node's SHA-256 (byte-identical digest) if the ICSF call
> fails, and says so explicitly rather than hiding it — see section 6.

---

## 6. Verified on the live system

* `BANKDB` database and `BANKAPP.USERS` / `BANKAPP.ACCOUNTS` created.
* Both migrated rows intact — hashes match the PostgreSQL originals byte for byte.
* `HASHUD` compiled (RC 0) and link-edited reentrant/reusable
  (`AMODE 31`, attributes `RN RU`) into `IBMUSER.HDFC.LOAD(HASHUD)` and
  `DSN910.DB9G.RUNLIB.LOAD(HASHUD)`.
* `BANKAPP.HASHUD` registered in the Db2 catalog.
* **JDBC connectivity from the workstation works** (`db2jcc4.jar` +
  `db2jcc_license_cisuz.jar`, `CURRENT SERVER = DALLAS9`).
* **The website runs on z/OS Db2**: register, login and the dashboard were all
  exercised end to end through the browser-facing API routes.
* **The stored-procedure mechanism now works.** After the WLM policy was
  activated, `-471` disappeared and `SYSIBM.SQLTABLES` — IBM's own JDBC support
  procedure — started returning a result set. That was the original blocker.
* **`HASHUD` produces the correct digest.** Called directly from a batch driver
  (`cobol/HASHDRV.cbl`, `jcl/BUILD-HASHDRV.jcl`), it returns
  `5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8` for
  `password` — exactly `SHA-256("password")`.

### The EBCDIC/ASCII trap (fixed)

ICSF hashes whatever bytes it is handed, and Db2 hands a COBOL program EBCDIC.
Hashing that directly produced a digest of the **EBCDIC** bytes:

```
ICSF('password' as EBCDIC) = 61E9F866F42264B13170F6C91BECA68C559E9C409328E695D4B13356526CD0F1
SHA-256('password' ASCII)  = 5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8
```

Every other tier — browser, Node crypto, the PostgreSQL mirror, and the hashes
already stored in `BANKAPP.USERS` — uses the ASCII/UTF-8 bytes. Had this shipped,
**both migrated users would have been locked out the moment ICSF started
working.** `cobol/HASHUD.cbl` now converts the text before hashing:

```cobol
MOVE FUNCTION NATIONAL-OF(WS-EBCDIC-TEXT, 037) TO WS-NATIONAL-TEXT
MOVE FUNCTION DISPLAY-OF(WS-NATIONAL-TEXT, 819) TO WS-ASCII-TEXT
```

(EBCDIC 037 → national → ISO-8859-1, which is byte-identical to UTF-8 for any
realistic password.)

### RESOLVED: `-4220` / `-330` — the missing `PARAMETER CCSID EBCDIC`

`CALL BANKAPP.HASHUD(...)` failed with `SQLCODE -4220` (`CharConversionException`)
over JDBC, and `SQLCODE -330` when called through an SQL wrapper. The fix was one
line in `CREATE PROCEDURE`:

```sql
    PARAMETER CCSID EBCDIC
```

**Why.** A COBOL program writes EBCDIC into its output parameters. Without
`PARAMETER CCSID`, Db2 does not know that, so it passes the EBCDIC bytes straight
through instead of converting them. The client then tries to decode `0xC1 0xC2 …`
as UTF-8, which is invalid, and throws. Measured on this system with the **same
load module**:

| `PARAMETER CCSID` | Result |
| ----------------- | ------ |
| *(omitted)* | `SQLCODE -4220` |
| `EBCDIC` | **correct digest** |
| `ASCII` | wrong characters |
| `UNICODE` | `SQLCODE -4220` |

Final definition: `sql/08-hashud-final-working.sql`.

### How it was isolated

The decisive experiment was a diagnostic twin, `cobol/HASHCONST.cbl` — identical
Db2 linkage, but returning a fixed constant and never calling ICSF:

| Procedure | Kind | Result |
| --------- | ---- | ------ |
| `TRIVIAL_CALL` | SQL proc, IN param, result set | works |
| `TESTOUT` | SQL proc, VARCHAR IN + CHAR(64)/INT OUT | works |
| `HASHCONST` | **external COBOL**, returns a constant | `-4220` |
| `HASHUD` | external COBOL, real ICSF | `-4220` |

That exonerated ICSF (HASHCONST never touches it), exonerated OUT parameters
(TESTOUT round-trips them fine), and left the external-procedure boundary — where
the CCSID turned out to be the answer.

Things that were tried and **did not** fix it, so they can be skipped next time:
`file.encoding` on the JVM, `ccsid=` and `retrieveMessagesFromServerOnGetMessage`
URL properties, `executeUpdate()` vs `execute()`, `Types.CHAR` vs `Types.VARCHAR`,
dropping `COMMIT ON RETURN YES`, switching the input to `CHAR(100)`, a newer
driver (JCC 11.5.9.0 cannot authenticate to this Db2 9.1 server at all), and
`PARAMETER CCSID UNICODE`/`ASCII`.

### Two other real problems found and fixed along the way

These were genuine blockers, separate from the CCSID issue:

1. **`-471` — WLM application environments inactive.** Fixed by activating the
   WLM policy. Confirmed when `SYSIBM.SQLTABLES`, IBM's own procedure, went from
   `-471` to returning a result set.
2. **`-444` — `DSN910.DB9G.RUNLIB.LOAD` was not APF-authorized.** The WLM address
   space runs APF, so a module from a non-APF library cannot be used. Fixed with
   `SETPROG APF,ADD,DSNAME=DSN910.DB9G.RUNLIB.LOAD,VOLUME=SBDB91`. Found by
   reading the APF list in `ADCD.Z111S.PARMLIB(PROGDB)`.

### Verified end to end

```
'password'  -> 5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8
'test'      -> 9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08
'Test User' -> 9E95A89B42F1FB5A3EA9F8657EC45354A080B57B8EF2F6DF85B73ADD1F756465
```

All return code 0 / reason code 0, and all match
`hashlib.sha256(pw.encode()).hexdigest()` exactly. The website was then exercised
end to end: registering a user stored the **ICSF-computed** digest in
`BANKAPP.USERS`, `GET /api/db2/status` reported `"engine":"icsf"`, logging in
succeeded, and a wrong password was rejected.

**Passwords are now hashed by ICSF on the mainframe.** The plaintext no longer
leaves the web tier — the property that was missing throughout.
