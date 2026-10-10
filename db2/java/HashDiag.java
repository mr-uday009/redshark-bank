import java.sql.*;

/** Print the full cause chain for the stored-procedure conversion failure. */
public class HashDiag {
    public static void main(String[] args) throws Exception {
        String url = args.length > 0 ? args[0] : "jdbc:db2://127.0.0.1:5025/DALLAS9";
        Class.forName("com.ibm.db2.jcc.DB2Driver");
        System.out.println("URL: " + url);
        System.out.println("file.encoding=" + System.getProperty("file.encoding"));
        Connection c = DriverManager.getConnection(url, "IBMUSER", "SYS1");

        System.out.println("--- plain SELECT (proves general char conversion) ---");
        Statement st = c.createStatement();
        ResultSet rs = st.executeQuery("SELECT USERNAME FROM BANKAPP.USERS WHERE ID=1");
        if (rs.next()) System.out.println("  ok: " + rs.getString(1));
        rs.close();
        st.close();

        System.out.println("--- BANKAPP.HASHUD ---");
        CallableStatement cs = c.prepareCall("CALL BANKAPP.HASHUD(?,?,?,?)");
        cs.setString(1, "password");
        cs.registerOutParameter(2, Types.CHAR);
        cs.registerOutParameter(3, Types.INTEGER);
        cs.registerOutParameter(4, Types.INTEGER);
        try {
            cs.execute();
            System.out.println("  ok hash=" + cs.getString(2));
        } catch (SQLException e) {
            System.out.println("  FAILED SQLState=" + e.getSQLState() + " ErrorCode=" + e.getErrorCode());
            Throwable t = e;
            int depth = 0;
            while (t != null && depth < 8) {
                System.out.println("  [" + depth + "] " + t.getClass().getName() + ": " + t.getMessage());
                t = t.getCause();
                depth++;
            }
        } finally {
            try { cs.close(); } catch (Exception ignore) {}
        }
        c.close();
    }
}
