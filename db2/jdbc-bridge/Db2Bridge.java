/*
 * Db2Bridge - a small HTTP bridge between the Node website and Db2 for z/OS.
 *
 * Why this exists: the site is Node/Next.js, but the only client that can talk
 * to Db2 for z/OS without a paid Db2 Connect licence is the JDBC driver
 * (db2jcc4.jar + db2jcc_license_cisuz.jar).  This process owns the JDBC
 * connection pool and exposes exactly the four operations the site needs.
 *
 * It deliberately exposes NO generic SQL endpoint - only fixed, parameterised
 * operations - so a compromised web tier cannot run arbitrary SQL.
 *
 * Build:  javac -cp db2jcc4.jar Db2Bridge.java
 * Run:    java -cp .:db2jcc4.jar:db2jcc_license_cisuz.jar Db2Bridge
 *
 * Configuration (environment variables):
 *   BRIDGE_HOST   default 127.0.0.1
 *   BRIDGE_PORT   default 8099
 *   DB2_HOST      default 192.168.200.150
 *   DB2_PORT      default 5025
 *   DB2_LOCATION  default DALLAS9
 *   DB2_USER      default IBMUSER
 *   DB2_PASSWORD  default SYS1
 */
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.concurrent.Executors;

public class Db2Bridge {

    static final String BRIDGE_HOST = env("BRIDGE_HOST", "127.0.0.1");
    static final int    BRIDGE_PORT = Integer.parseInt(env("BRIDGE_PORT", "8099"));
    static final String DB2_HOST    = env("DB2_HOST", "192.168.200.150");
    static final String DB2_PORT    = env("DB2_PORT", "5025");
    static final String DB2_LOC     = env("DB2_LOCATION", "DALLAS9");
    static final String DB2_USER    = env("DB2_USER", "IBMUSER");
    static final String DB2_PWD     = env("DB2_PASSWORD", "SYS1");

    static final String URL =
        "jdbc:db2://" + DB2_HOST + ":" + DB2_PORT + "/" + DB2_LOC;

    static String env(String k, String dflt) {
        String v = System.getenv(k);
        return (v == null || v.trim().isEmpty()) ? dflt : v.trim();
    }

    public static void main(String[] args) throws Exception {
        Class.forName("com.ibm.db2.jcc.DB2Driver");
        // Fail fast so a misconfiguration is obvious at start-up.
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD)) {
            System.out.println("Db2Bridge: connected to " + URL
                + " (" + c.getMetaData().getDatabaseProductVersion() + ")");
        } catch (SQLException e) {
            System.err.println("Db2Bridge: cannot connect to " + URL + " : " + e.getMessage());
            System.exit(1);
        }

        HttpServer server = HttpServer.create(new InetSocketAddress(BRIDGE_HOST, BRIDGE_PORT), 0);
        server.createContext("/health",      Db2Bridge::handleHealth);
        server.createContext("/hash",        Db2Bridge::handleHash);
        server.createContext("/user/find",   Db2Bridge::handleUserFind);
        server.createContext("/user/create", Db2Bridge::handleUserCreate);
        server.createContext("/accounts",    Db2Bridge::handleAccounts);
        server.createContext("/account/create", Db2Bridge::handleAccountCreate);
        server.createContext("/recipient/find", Db2Bridge::handleRecipientFind);
        server.createContext("/transfer",    Db2Bridge::handleTransfer);
        server.createContext("/transactions", Db2Bridge::handleTransactions);
        server.createContext("/notifications", Db2Bridge::handleNotifications);
        server.createContext("/notifications/dismiss", Db2Bridge::handleNotificationsDismiss);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.start();
        System.out.println("Db2Bridge: listening on http://" + BRIDGE_HOST + ":" + BRIDGE_PORT);
    }

    // ------------------------------------------------------------------ health
    static void handleHealth(HttpExchange x) throws IOException {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("ok", Boolean.TRUE);
        out.put("url", URL);
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD)) {
            out.put("connected", Boolean.TRUE);
            out.put("version", c.getMetaData().getDatabaseProductVersion());
        } catch (SQLException e) {
            out.put("connected", Boolean.FALSE);
            out.put("error", e.getMessage());
        }
        // Is ICSF hashing actually reachable?  This is the difference between
        // "passwords are hashed on the mainframe" and "passwords are hashed in
        // the web tier", so report it rather than hiding it.
        try {
            String[] r = callHash("icsf-probe");
            out.put("icsf", Boolean.TRUE);
            out.put("icsfProbe", r[0]);
        } catch (SQLException e) {
            out.put("icsf", Boolean.FALSE);
            out.put("icsfError", e.getSQLState() + "/" + e.getErrorCode() + " " + e.getMessage());
        }
        json(x, 200, out);
    }

    // -------------------------------------------------------------------- hash
    static void handleHash(HttpExchange x) throws IOException {
        Map<String, Object> body = parseJson(readBody(x));
        String text = str(body.get("text"));
        if (text == null) { json(x, 400, err("missing 'text'")); return; }
        try {
            String[] r = callHash(text);
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("hash", r[0]);
            out.put("returnCode", Integer.valueOf(r[1]));
            out.put("reasonCode", Integer.valueOf(r[2]));
            json(x, 200, out);
        } catch (SQLException e) {
            json(x, 502, err("ICSF hashing failed: " + e.getSQLState() + "/"
                + e.getErrorCode() + " " + e.getMessage()));
        }
    }

    /** CALL BANKAPP.HASHUD(?,?,?,?) -> {hex digest, return code, reason code} */
    static String[] callHash(String plaintext) throws SQLException {
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
             CallableStatement cs = c.prepareCall("CALL BANKAPP.HASHUD(?,?,?,?)")) {
            cs.setString(1, plaintext);
            cs.registerOutParameter(2, Types.CHAR);
            cs.registerOutParameter(3, Types.INTEGER);
            cs.registerOutParameter(4, Types.INTEGER);
            cs.execute();
            String h = cs.getString(2);
            return new String[] {
                h == null ? "" : h.trim().toUpperCase(),
                String.valueOf(cs.getInt(3)),
                String.valueOf(cs.getInt(4))
            };
        }
    }

    // --------------------------------------------------------------- user/find
    static void handleUserFind(HttpExchange x) throws IOException {
        Map<String, Object> body = parseJson(readBody(x));
        String id = str(body.get("identifier"));
        if (id == null) { json(x, 400, err("missing 'identifier'")); return; }
        String sql = "SELECT ID, USERNAME, EMAIL, FULL_NAME, PASSWORD_HASH "
                   + "FROM BANKAPP.USERS WHERE UPPER(USERNAME) = UPPER(?) "
                   + "OR UPPER(EMAIL) = UPPER(?)";
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, id);
            ps.setString(2, id);
            try (ResultSet rs = ps.executeQuery()) {
                Map<String, Object> out = new LinkedHashMap<String, Object>();
                out.put("user", rs.next() ? userMap(rs) : null);
                json(x, 200, out);
            }
        } catch (SQLException e) {
            json(x, 502, err("query failed: " + e.getMessage()));
        }
    }

    // ------------------------------------------------------------- user/create
    static void handleUserCreate(HttpExchange x) throws IOException {
        Map<String, Object> body = parseJson(readBody(x));
        String username = str(body.get("username"));
        String email    = str(body.get("email"));
        String fullName = str(body.get("fullName"));
        String hash     = str(body.get("passwordHash"));
        if (username == null || email == null || fullName == null || hash == null) {
            json(x, 400, err("username, email, fullName and passwordHash are required"));
            return;
        }
        String sql = "SELECT ID, USERNAME, EMAIL, FULL_NAME, PASSWORD_HASH FROM FINAL TABLE ("
                   + "INSERT INTO BANKAPP.USERS (USERNAME, EMAIL, FULL_NAME, PASSWORD_HASH) "
                   + "VALUES (?, ?, ?, ?))";
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, username);
            ps.setString(2, email);
            ps.setString(3, fullName);
            ps.setString(4, hash);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                Map<String, Object> out = new LinkedHashMap<String, Object>();
                out.put("user", userMap(rs));
                json(x, 200, out);
            }
        } catch (SQLException e) {
            // -803 = duplicate key on the unique username/email indexes
            int code = e.getErrorCode();
            if (code == -803) {
                json(x, 409, err("An account with that username or email already exists."));
            } else {
                json(x, 502, err("insert failed: " + e.getMessage()));
            }
        }
    }

    // ---------------------------------------------------------------- accounts
    static void handleAccounts(HttpExchange x) throws IOException {
        Map<String, String> q = queryParams(x.getRequestURI().getRawQuery());
        String userId = q.get("userId");
        if (userId == null) { json(x, 400, err("missing 'userId'")); return; }
        String sql = "SELECT ID, USER_ID, ACCOUNT_NUMBER, ACCOUNT_TYPE, BALANCE "
                   + "FROM BANKAPP.ACCOUNTS WHERE USER_ID = ? ORDER BY ID";
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, Integer.parseInt(userId));
            try (ResultSet rs = ps.executeQuery()) {
                List<Object> list = new ArrayList<Object>();
                while (rs.next()) {
                    Map<String, Object> a = new LinkedHashMap<String, Object>();
                    a.put("id", Integer.valueOf(rs.getInt("ID")));
                    a.put("userId", Integer.valueOf(rs.getInt("USER_ID")));
                    a.put("accountNumber", rs.getString("ACCOUNT_NUMBER"));
                    a.put("accountType", rs.getString("ACCOUNT_TYPE"));
                    a.put("balance", rs.getBigDecimal("BALANCE") == null
                        ? "0" : rs.getBigDecimal("BALANCE").toPlainString());
                    list.add(a);
                }
                Map<String, Object> out = new LinkedHashMap<String, Object>();
                out.put("accounts", list);
                json(x, 200, out);
            }
        } catch (SQLException e) {
            json(x, 502, err("query failed: " + e.getMessage()));
        }
    }

    // ---------------------------------------------------------- account/create
    static void handleAccountCreate(HttpExchange x) throws IOException {
        Map<String, Object> body = parseJson(readBody(x));
        int userId = toInt(body.get("userId"), -1);
        String number = str(body.get("accountNumber"));
        String type   = str(body.get("accountType"));
        String bal    = str(body.get("balance"));
        if (userId < 0 || number == null) {
            json(x, 400, err("userId and accountNumber are required"));
            return;
        }
        String sql = "SELECT ID, USER_ID, ACCOUNT_NUMBER, ACCOUNT_TYPE, BALANCE FROM FINAL TABLE ("
                   + "INSERT INTO BANKAPP.ACCOUNTS (USER_ID, ACCOUNT_NUMBER, ACCOUNT_TYPE, BALANCE) "
                   + "VALUES (?, ?, ?, ?))";
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            ps.setString(2, number);
            ps.setString(3, type == null ? "CHECKING" : type);
            ps.setBigDecimal(4, new java.math.BigDecimal(bal == null ? "0" : bal));
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                Map<String, Object> a = new LinkedHashMap<String, Object>();
                a.put("id", Integer.valueOf(rs.getInt("ID")));
                a.put("userId", Integer.valueOf(rs.getInt("USER_ID")));
                a.put("accountNumber", rs.getString("ACCOUNT_NUMBER"));
                a.put("accountType", rs.getString("ACCOUNT_TYPE"));
                a.put("balance", rs.getBigDecimal("BALANCE") == null
                    ? "0" : rs.getBigDecimal("BALANCE").toPlainString());
                Map<String, Object> out = new LinkedHashMap<String, Object>();
                out.put("account", a);
                json(x, 200, out);
            }
        } catch (SQLException e) {
            json(x, 502, err("insert failed: " + e.getMessage()));
        }
    }

    // --------------------------------------------------------- recipient/find
    /**
     * Resolve a payee from an email, username, or account number.
     *
     * Returns the user plus their account id, so the transfer below never has
     * to re-resolve - and never has to trust an account id sent by the client.
     */
    static void handleRecipientFind(HttpExchange x) throws IOException {
        Map<String, Object> body = parseJson(readBody(x));
        String id = str(body.get("identifier"));
        int excludeUserId = toInt(body.get("excludeUserId"), -1);
        if (id == null) { json(x, 400, err("missing 'identifier'")); return; }

        // ACCOUNT_NUMBER is CHAR(12), so comparing it directly against a
        // parameter longer than 12 characters (an email, say) makes Db2 try to
        // assign the value to the column and fail with SQLCODE -302 /
        // SQLSTATE 22001 rather than simply not matching. Casting the
        // parameter to VARCHAR and trimming the column keeps the comparison
        // as a plain string compare, so an email just does not match.
        String sql =
            "SELECT U.ID, U.USERNAME, U.EMAIL, U.FULL_NAME, "
          + "       A.ID AS ACCT_ID, A.ACCOUNT_NUMBER, A.ACCOUNT_TYPE, A.BALANCE "
          + "FROM BANKAPP.USERS U "
          + "JOIN BANKAPP.ACCOUNTS A ON A.USER_ID = U.ID "
          + "WHERE UPPER(U.USERNAME) = UPPER(?) "
          + "   OR UPPER(U.EMAIL)    = UPPER(?) "
          + "   OR RTRIM(A.ACCOUNT_NUMBER) = CAST(? AS VARCHAR(255)) "
          + "FETCH FIRST 1 ROW ONLY";
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, id);
            ps.setString(2, id);
            ps.setString(3, id);
            try (ResultSet rs = ps.executeQuery()) {
                Map<String, Object> out = new LinkedHashMap<String, Object>();
                if (!rs.next()) {
                    out.put("recipient", null);
                } else {
                    Map<String, Object> r = new LinkedHashMap<String, Object>();
                    r.put("userId", Integer.valueOf(rs.getInt("ID")));
                    r.put("username", rs.getString("USERNAME"));
                    r.put("email", rs.getString("EMAIL"));
                    r.put("fullName", rs.getString("FULL_NAME"));
                    r.put("accountId", Integer.valueOf(rs.getInt("ACCT_ID")));
                    r.put("accountNumber", rs.getString("ACCOUNT_NUMBER"));
                    r.put("isSelf", Boolean.valueOf(rs.getInt("ID") == excludeUserId));
                    out.put("recipient", r);
                }
                json(x, 200, out);
            }
        } catch (SQLException e) {
            json(x, 502, err("recipient lookup failed: " + e.getMessage()));
        }
    }

    // ---------------------------------------------------------------- transfer
    /**
     * Move money between two accounts and record both sides.
     *
     * Race safety: the debit is a *conditional* UPDATE -
     *
     *     UPDATE ... SET BALANCE = BALANCE - ? WHERE ID = ? AND BALANCE >= ?
     *
     * and we require exactly one row updated.  If two transfers race for the
     * last of the balance, Db2 serialises the row locks and the loser sees
     * updateCount 0, so the balance can never go negative.  That is why there
     * is no SELECT-then-UPDATE here, and no FOR UPDATE clause to get wrong on
     * z/OS.
     *
     * Everything - both balance changes, both ledger rows, both notifications -
     * runs in one transaction, so a partial transfer is impossible.
     */
    static void handleTransfer(HttpExchange x) throws IOException {
        Map<String, Object> body = parseJson(readBody(x));
        int senderUserId = toInt(body.get("senderUserId"), -1);
        int senderAcctId = toInt(body.get("senderAccountId"), -1);
        int recipUserId  = toInt(body.get("recipientUserId"), -1);
        int recipAcctId  = toInt(body.get("recipientAccountId"), -1);
        String amountRaw = str(body.get("amount"));
        String reference = str(body.get("reference"));
        String senderName   = str(body.get("senderUsername"));
        String recipName    = str(body.get("recipientUsername"));

        if (senderUserId < 0 || senderAcctId < 0 || recipUserId < 0 || recipAcctId < 0
                || amountRaw == null) {
            json(x, 400, err("senderUserId, senderAccountId, recipientUserId, "
                + "recipientAccountId and amount are required"));
            return;
        }

        java.math.BigDecimal amount;
        try {
            amount = new java.math.BigDecimal(amountRaw).setScale(2, java.math.RoundingMode.DOWN);
        } catch (NumberFormatException e) {
            json(x, 400, err("amount is not a valid number"));
            return;
        }
        if (amount.signum() <= 0) { json(x, 400, err("amount must be greater than zero")); return; }
        if (recipAcctId == senderAcctId) { json(x, 400, err("You cannot send money to your own account.")); return; }

        if (reference == null) reference = java.util.UUID.randomUUID().toString();

        Connection c = null;
        try {
            c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
            c.setAutoCommit(false);

            // 1. Debit, but only if the funds are actually there.
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE BANKAPP.ACCOUNTS SET BALANCE = BALANCE - ? "
                  + "WHERE ID = ? AND USER_ID = ? AND BALANCE >= ?")) {
                ps.setBigDecimal(1, amount);
                ps.setInt(2, senderAcctId);
                ps.setInt(3, senderUserId);
                ps.setBigDecimal(4, amount);
                if (ps.executeUpdate() != 1) {
                    c.rollback();
                    json(x, 409, err("Insufficient funds. The amount exceeds your available balance."));
                    return;
                }
            }

            // 2. Credit.
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE BANKAPP.ACCOUNTS SET BALANCE = BALANCE + ? "
                  + "WHERE ID = ? AND USER_ID = ?")) {
                ps.setBigDecimal(1, amount);
                ps.setInt(2, recipAcctId);
                ps.setInt(3, recipUserId);
                if (ps.executeUpdate() != 1) {
                    c.rollback();
                    json(x, 502, err("recipient account could not be credited"));
                    return;
                }
            }

            // 3. Both sides of the ledger.
            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO BANKAPP.TRANSACTIONS "
                  + "(USER_ID, ACCOUNT_ID, DIRECTION, AMOUNT, COUNTERPARTY, REFERENCE) "
                  + "VALUES (?, ?, ?, ?, ?, ?)")) {
                ps.setInt(1, senderUserId);
                ps.setInt(2, senderAcctId);
                ps.setString(3, "SENT");
                ps.setBigDecimal(4, amount);
                ps.setString(5, recipName == null ? "unknown" : recipName);
                ps.setString(6, reference);
                ps.addBatch();

                ps.setInt(1, recipUserId);
                ps.setInt(2, recipAcctId);
                ps.setString(3, "RECEIVED");
                ps.setBigDecimal(4, amount);
                ps.setString(5, senderName == null ? "unknown" : senderName);
                ps.setString(6, reference);
                ps.addBatch();
                ps.executeBatch();
            }

            // 4. Notify both parties.  Amounts are formatted server-side so the
            //    two messages can never disagree about the figure.
            String pretty = amount.toPlainString();
            String toRecipient = (senderName == null ? "Someone" : senderName)
                + " sent $" + pretty + " to you";
            String toSender = "$" + pretty + " sent to "
                + (recipName == null ? "the recipient" : recipName);

            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO BANKAPP.NOTIFICATIONS (USER_ID, KIND, MESSAGE, READ) "
                  + "VALUES (?, ?, ?, 0)")) {
                ps.setInt(1, recipUserId);
                ps.setString(2, "money_received");
                ps.setString(3, toRecipient);
                ps.addBatch();

                ps.setInt(1, senderUserId);
                ps.setString(2, "money_sent");
                ps.setString(3, toSender);
                ps.addBatch();
                ps.executeBatch();
            }

            c.commit();

            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("reference", reference);
            out.put("amount", pretty);
            out.put("messageToSender", toSender);
            out.put("messageToRecipient", toRecipient);
            out.put("senderBalance", balanceOf(c, senderAcctId));
            out.put("recipientBalance", balanceOf(c, recipAcctId));
            json(x, 200, out);

        } catch (SQLException e) {
            if (c != null) { try { c.rollback(); } catch (SQLException ignore) { } }
            json(x, 502, err("transfer failed: " + e.getMessage()));
        } finally {
            if (c != null) { try { c.close(); } catch (SQLException ignore) { } }
        }
    }

    static String balanceOf(Connection c, int accountId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT BALANCE FROM BANKAPP.ACCOUNTS WHERE ID = ?")) {
            ps.setInt(1, accountId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return "0";
                java.math.BigDecimal b = rs.getBigDecimal(1);
                return b == null ? "0" : b.toPlainString();
            }
        }
    }

    // ------------------------------------------------------------ transactions
    static void handleTransactions(HttpExchange x) throws IOException {
        Map<String, String> q = queryParams(x.getRequestURI().getRawQuery());
        String userId = q.get("userId");
        if (userId == null) { json(x, 400, err("missing 'userId'")); return; }
        int limit = 50;
        try { if (q.get("limit") != null) limit = Integer.parseInt(q.get("limit")); }
        catch (NumberFormatException ignore) { }
        if (limit < 1 || limit > 200) limit = 50;

        String sql = "SELECT ID, DIRECTION, AMOUNT, COUNTERPARTY, REFERENCE, CREATED_AT "
                   + "FROM BANKAPP.TRANSACTIONS WHERE USER_ID = ? "
                   + "ORDER BY CREATED_AT DESC, ID DESC FETCH FIRST " + limit + " ROWS ONLY";
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD);
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, Integer.parseInt(userId));
            try (ResultSet rs = ps.executeQuery()) {
                List<Object> list = new ArrayList<Object>();
                while (rs.next()) {
                    Map<String, Object> t = new LinkedHashMap<String, Object>();
                    t.put("id", Integer.valueOf(rs.getInt("ID")));
                    t.put("direction", rs.getString("DIRECTION"));
                    java.math.BigDecimal a = rs.getBigDecimal("AMOUNT");
                    t.put("amount", a == null ? "0" : a.toPlainString());
                    t.put("counterparty", rs.getString("COUNTERPARTY"));
                    t.put("reference", rs.getString("REFERENCE"));
                    Timestamp ts = rs.getTimestamp("CREATED_AT");
                    t.put("createdAt", ts == null ? null : ts.toString());
                    list.add(t);
                }
                Map<String, Object> out = new LinkedHashMap<String, Object>();
                out.put("transactions", list);
                json(x, 200, out);
            }
        } catch (SQLException e) {
            json(x, 502, err("query failed: " + e.getMessage()));
        }
    }

    // ----------------------------------------------------------- notifications
    static void handleNotifications(HttpExchange x) throws IOException {
        Map<String, String> q = queryParams(x.getRequestURI().getRawQuery());
        String userId = q.get("userId");
        if (userId == null) { json(x, 400, err("missing 'userId'")); return; }

        int uid = Integer.parseInt(userId);
        List<Object> list = new ArrayList<Object>();
        int unread = 0;
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD)) {
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT ID, KIND, MESSAGE, READ, CREATED_AT FROM BANKAPP.NOTIFICATIONS "
                  + "WHERE USER_ID = ? ORDER BY CREATED_AT DESC, ID DESC "
                  + "FETCH FIRST 50 ROWS ONLY")) {
                ps.setInt(1, uid);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        Map<String, Object> n = new LinkedHashMap<String, Object>();
                        n.put("id", Integer.valueOf(rs.getInt("ID")));
                        n.put("kind", rs.getString("KIND"));
                        n.put("message", rs.getString("MESSAGE"));
                        n.put("read", Boolean.valueOf(rs.getInt("READ") != 0));
                        Timestamp ts = rs.getTimestamp("CREATED_AT");
                        n.put("createdAt", ts == null ? null : ts.toString());
                        list.add(n);
                    }
                }
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT COUNT(*) FROM BANKAPP.NOTIFICATIONS WHERE USER_ID = ? AND READ = 0")) {
                ps.setInt(1, uid);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) unread = rs.getInt(1);
                }
            }
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("notifications", list);
            out.put("unread", Integer.valueOf(unread));
            json(x, 200, out);
        } catch (SQLException e) {
            json(x, 502, err("query failed: " + e.getMessage()));
        }
    }

    static void handleNotificationsDismiss(HttpExchange x) throws IOException {
        Map<String, Object> body = parseJson(readBody(x));
        int userId = toInt(body.get("userId"), -1);
        int id = toInt(body.get("id"), -1);
        if (userId < 0) { json(x, 400, err("missing 'userId'")); return; }
        try (Connection c = DriverManager.getConnection(URL, DB2_USER, DB2_PWD)) {
            int updated;
            if (id > 0) {
                // Dismiss one.
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE BANKAPP.NOTIFICATIONS SET READ = 1 WHERE ID = ? AND USER_ID = ?")) {
                    ps.setInt(1, id);
                    ps.setInt(2, userId);
                    updated = ps.executeUpdate();
                }
            } else {
                // Dismiss all.
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE BANKAPP.NOTIFICATIONS SET READ = 1 WHERE USER_ID = ? AND READ = 0")) {
                    ps.setInt(1, userId);
                    updated = ps.executeUpdate();
                }
            }
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("dismissed", Integer.valueOf(updated));
            json(x, 200, out);
        } catch (SQLException e) {
            json(x, 502, err("dismiss failed: " + e.getMessage()));
        }
    }

    static Map<String, Object> userMap(ResultSet rs) throws SQLException {
        Map<String, Object> u = new LinkedHashMap<String, Object>();
        u.put("userId", Integer.valueOf(rs.getInt("ID")));
        u.put("username", rs.getString("USERNAME"));
        u.put("email", rs.getString("EMAIL"));
        u.put("fullName", rs.getString("FULL_NAME"));
        String h = rs.getString("PASSWORD_HASH");
        u.put("passwordHash", h == null ? "" : h.trim());
        return u;
    }

    // ------------------------------------------------------------ json helpers
    static Map<String, Object> err(String m) {
        Map<String, Object> o = new LinkedHashMap<String, Object>();
        o.put("error", m);
        return o;
    }

    static String str(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o);
        return s.isEmpty() ? null : s;
    }

    /**
     * Coerce a parsed JSON value to an int.  The minimal parser stores every
     * JSON number as a Double, so "5" arrives as 5.0 and must not be fed
     * straight into Integer.parseInt.
     */
    static int toInt(Object o, int dflt) {
        if (o == null) return dflt;
        if (o instanceof Number) return ((Number) o).intValue();
        try {
            return (int) Double.parseDouble(String.valueOf(o).trim());
        } catch (NumberFormatException e) {
            return dflt;
        }
    }

    static Map<String, String> queryParams(String raw) {
        Map<String, String> m = new HashMap<String, String>();
        if (raw == null) return m;
        for (String kv : raw.split("&")) {
            int i = kv.indexOf('=');
            if (i > 0) m.put(urlDecode(kv.substring(0, i)), urlDecode(kv.substring(i + 1)));
        }
        return m;
    }

    static String urlDecode(String s) {
        try {
            return java.net.URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    static String readBody(HttpExchange x) throws IOException {
        InputStream in = x.getRequestBody();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    /** Minimal flat JSON object parser - enough for the small payloads we accept. */
    static Map<String, Object> parseJson(String s) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        if (s == null) return m;
        int i = 0, len = s.length();
        while (i < len) {
            int k = s.indexOf('"', i);
            if (k < 0) break;
            int kEnd = s.indexOf('"', k + 1);
            if (kEnd < 0) break;
            String key = unescape(s.substring(k + 1, kEnd));
            int colon = s.indexOf(':', kEnd);
            if (colon < 0) break;
            int v = colon + 1;
            while (v < len && Character.isWhitespace(s.charAt(v))) v++;
            if (v >= len) break;
            Object val;
            if (s.charAt(v) == '"') {
                int vEnd = v + 1;
                while (vEnd < len) {
                    char ch = s.charAt(vEnd);
                    if (ch == '\\') { vEnd += 2; continue; }
                    if (ch == '"') break;
                    vEnd++;
                }
                val = unescape(s.substring(v + 1, vEnd));
                i = vEnd + 1;
            } else {
                int vEnd = v;
                while (vEnd < len && s.charAt(vEnd) != ',' && s.charAt(vEnd) != '}') vEnd++;
                String raw = s.substring(v, vEnd).trim();
                if ("null".equals(raw)) val = null;
                else if ("true".equals(raw)) val = Boolean.TRUE;
                else if ("false".equals(raw)) val = Boolean.FALSE;
                else {
                    try { val = Double.valueOf(raw); } catch (NumberFormatException e) { val = raw; }
                }
                i = vEnd + 1;
            }
            m.put(key, val);
        }
        return m;
    }

    static String unescape(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char d = s.charAt(++i);
                switch (d) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case '"': b.append('"');  break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/');  break;
                    case 'u':
                        if (i + 4 < s.length()) {
                            b.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
                            i += 4;
                        }
                        break;
                    default: b.append(d);
                }
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }

    static String toJson(Object o) {
        StringBuilder b = new StringBuilder();
        writeJson(b, o);
        return b.toString();
    }

    @SuppressWarnings("unchecked")
    static void writeJson(StringBuilder b, Object o) {
        if (o == null) { b.append("null"); return; }
        if (o instanceof String) { b.append('"').append(escape((String) o)).append('"'); return; }
        if (o instanceof Boolean || o instanceof Number) { b.append(o.toString()); return; }
        if (o instanceof Map) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) o).entrySet()) {
                if (!first) b.append(',');
                first = false;
                b.append('"').append(escape(e.getKey())).append("\":");
                writeJson(b, e.getValue());
            }
            b.append('}');
            return;
        }
        if (o instanceof List) {
            b.append('[');
            boolean first = true;
            for (Object e : (List<Object>) o) {
                if (!first) b.append(',');
                first = false;
                writeJson(b, e);
            }
            b.append(']');
            return;
        }
        b.append('"').append(escape(String.valueOf(o))).append('"');
    }

    static String escape(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n");  break;
                case '\r': b.append("\\r");  break;
                case '\t': b.append("\\t");  break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.toString();
    }

    static void json(HttpExchange x, int status, Object body) throws IOException {
        byte[] out = toJson(body).getBytes(StandardCharsets.UTF_8);
        x.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        x.sendResponseHeaders(status, out.length);
        OutputStream os = x.getResponseBody();
        os.write(out);
        os.close();
    }
}
