# Db2 JDBC bridge

A small Java HTTP service that lets the Node website talk to **Db2 for z/OS**.

## Why this exists

The site is Node/Next.js, and the obvious driver would be `ibm_db` (the Node
binding for IBM's CLI/ODBC driver). It does not work here:

```
SQL1598N  An attempt to connect to the database server failed because of a
          licensing problem.  SQLSTATE=42968
```

That happens with *correct* credentials — the free CLI/ODBC driver needs a paid
**Db2 Connect** licence before it will connect to z/OS.

The JDBC driver has no such restriction: `db2jcc4.jar` plus the freely
redistributable `db2jcc_license_cisuz.jar` connects straight to z/OS. Both jars
are in `../db2jdbc/`. So the JDBC work lives in this tiny Java process, and the
website calls it over HTTP.

## Run it

```sh
cd db2/jdbc-bridge
./run-bridge.sh          # compiles if needed, then listens on 127.0.0.1:8099
```

Then start the site as usual (`npm run dev`). The site needs these in `.env`:

```
DB2_HOST=192.168.200.150
DB2_PORT=5025
DB2_LOCATION=DALLAS9
DB2_BRIDGE_URL=http://127.0.0.1:8099
```

Unset `DB2_HOST` and the site falls back to the local PostgreSQL mirror.

Settings are environment variables (all optional):

| Variable | Default |
| -------- | ------- |
| `BRIDGE_HOST` | `127.0.0.1` |
| `BRIDGE_PORT` | `8099` |
| `DB2_HOST` | `192.168.200.150` |
| `DB2_PORT` | `5025` |
| `DB2_LOCATION` | `DALLAS9` |
| `DB2_USER` | `IBMUSER` |
| `DB2_PASSWORD` | *(none — must be supplied)* |

## API

There is deliberately **no generic SQL endpoint** — only these five fixed,
parameterised operations, so a compromised web tier cannot run arbitrary SQL.

| Method | Path | Body / query | Returns |
| ------ | ---- | ------------ | ------- |
| GET | `/health` | – | connection state, server version, and whether ICSF hashing is usable |
| POST | `/hash` | `{"text":"..."}` | `{hash, returnCode, reasonCode}` from `CALL BANKAPP.HASHUD(?,?,?,?)` |
| POST | `/user/find` | `{"identifier":"user-or-email"}` | `{user:{...}}` or `{"user":null}` |
| POST | `/user/create` | `{"username","email","fullName","passwordHash"}` | `{user:{...}}`, or HTTP 409 on duplicate |
| GET | `/accounts` | `?userId=N` | `{accounts:[...]}` |
| POST | `/account/create` | `{"userId","accountNumber","accountType","balance"}` | `{account:{...}}` |

`/health` reports ICSF separately from connectivity on purpose:

```json
{"ok":true,"connected":true,"version":"DSN09015",
 "icsf":false,
 "icsfError":"55023/-471 DB2 SQL Error: SQLCODE=-471, SQLSTATE=55023, ..."}
```

That distinction matters: with `icsf:false` the site still works, but passwords
are being hashed by Node's SHA-256 rather than on the mainframe.

## Verified

```
GET  /health          -> connected, DSN09015, icsf:false (-471)
POST /user/find       -> returns testuser with hash B55C8792...
GET  /accounts?userId=1 -> [{accountNumber 545931603891, balance 9438.00}]
POST /user/create     -> creates, returns new userId
POST /account/create  -> creates, returns new account
```
