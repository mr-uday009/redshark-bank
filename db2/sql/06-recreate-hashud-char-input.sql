-- ===========================================================================
-- BANKAPP.HASHUD - CHAR(100) input variant
-- ===========================================================================
--
-- WHY THIS CHANGED FROM VARCHAR(100) TO CHAR(100)
--
-- IBM's "Example of GENERAL linkage convention" declares a character
-- parameter as a FLAT picture:
--
--     IN V1 INT, OUT V2 CHAR(9)
--     01 V1  PIC S9(9) USAGE COMP.
--     01 V2  PIC X(9).
--
-- and gives no VARCHAR example at all.
--
-- Under GENERAL linkage the parameters arrive as a LIST OF POINTERS.  If Db2
-- passes a VARCHAR as TWO pointers (length, then data) while the program
-- declares a single item, then every following parameter is shifted by one:
-- the CHAR(64) OUT area gets the INTEGER, the INTEGER gets the CHAR(64), and
-- so on.  Db2 then reads back whatever was in those areas, which is not valid
-- character data - surfacing as:
--
--     JDBC : SQLCODE -4220  CharConversionException
--     SQL  : SQLCODE -330   invalid character data
--
-- That matches the evidence exactly: BANKAPP.TESTOUT (an SQL procedure with
-- VARCHAR IN + CHAR(64) OUT + INTEGER OUT) works perfectly over JDBC, while
-- both external COBOL procedures fail - including one that never calls ICSF.
--
-- CHAR(100) keeps the parameter to a single flat pointer.  The procedure
-- trims the trailing blanks before hashing.
--
-- The application must send the password blank-padded to 100 characters (or
-- simply as a string; Db2 pads it).
-- ===========================================================================

DROP PROCEDURE BANKAPP.HASHUD;

CREATE PROCEDURE BANKAPP.HASHUD
    (IN  PLAIN_TEXT     CHAR(100),
     OUT HASH_OUT       CHAR(64),
     OUT RETURN_CODE    INTEGER,
     OUT REASON_CODE    INTEGER)
    LANGUAGE COBOL
    PARAMETER STYLE GENERAL
    EXTERNAL NAME HASHUD
    WLM ENVIRONMENT DB9GENV1
    COMMIT ON RETURN YES
    NO SQL;

GRANT EXECUTE ON PROCEDURE BANKAPP.HASHUD TO PUBLIC;

SELECT NAME, EXTERNAL_NAME, LANGUAGE, WLM_ENVIRONMENT
  FROM SYSIBM.SYSROUTINES WHERE NAME = 'HASHUD';

-- ===========================================================================
-- Test it.  Expected digest for 'password':
--   5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8
-- ===========================================================================
-- From JDBC:
--   CallableStatement cs = c.prepareCall("CALL BANKAPP.HASHUD(?,?,?,?)");
--   cs.setString(1, "password");            // Db2 pads to CHAR(100)
--   cs.registerOutParameter(2, Types.CHAR);
--   cs.registerOutParameter(3, Types.INTEGER);
--   cs.registerOutParameter(4, Types.INTEGER);
--   cs.execute();
--   System.out.println(cs.getString(2));
--
-- From SPUFI, via the wrapper (see 05-call-from-spufi.sql):
--   CALL BANKAPP.HASHUD_CALL('password');
