// Reference connectivity smoke test (as supplied) for validating the
// db2jcc4.jar JDBC driver path to Db2 for z/OS independently of the
// website. Useful for confirming host/port/location/credentials before
// wiring the same values into the website's DB2_* environment variables
// (see ../README.md and src/lib/db2.ts).
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;

public class Db2Test {

    public static void main(String[] args) {

        String host = "192.168.100.150";
        String port = "5025";
        String location = "DALLAS9";

        String user = "IBMUSER";
        String password = "SYS1";

        String url = "jdbc:db2://" + host + ":" + port + "/" + location;

        System.out.println("=================================");
        System.out.println("Db2 JDBC Connection Test");
        System.out.println("=================================");
        System.out.println("URL: " + url);
        System.out.println("Connecting...");

        try {
            Class.forName("com.ibm.db2.jcc.DB2Driver");

            try (Connection connection = DriverManager.getConnection(url, user, password);
                 Statement statement = connection.createStatement()) {

                System.out.println("\nSUCCESS!\nConnected to Db2.");

                try (ResultSet serverResult = statement.executeQuery("SELECT CURRENT SERVER FROM SYSIBM.SYSDUMMY1")) {
                    while (serverResult.next()) {
                        System.out.println("CURRENT SERVER = " + serverResult.getString(1));
                    }
                }

                System.out.println("\n--- Querying EMPTAB ---");

                try (ResultSet empResult = statement.executeQuery("SELECT * FROM EMPTAB")) {
                    ResultSetMetaData metaData = empResult.getMetaData();
                    int columnCount = metaData.getColumnCount();

                    for (int i = 1; i <= columnCount; i++) {
                        System.out.print(metaData.getColumnName(i) + "\t");
                    }
                    System.out.println("\n------------------------------------------------");

                    while (empResult.next()) {
                        for (int i = 1; i <= columnCount; i++) {
                            System.out.print(empResult.getString(i) + "\t");
                        }
                        System.out.println();
                    }
                }
            }

            System.out.println("\nConnection closed.");

        } catch (Exception e) {
            System.out.println("\nCONNECTION OR QUERY FAILED\n");
            e.printStackTrace();
        }
    }
}
