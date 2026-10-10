-- ===========================================================================
-- Verification
-- ===========================================================================

-- 1. Tables and their state.  STATUS must be 'A' or blank for the table to be
--    usable; 'I' (incomplete) means the table was created while its table
--    space was still stopped, and every access will fail with -540.
SELECT NAME, STATUS, DBNAME, TSNAME FROM SYSIBM.SYSTABLES WHERE CREATOR = 'BANKAPP';

-- 2. The procedure registration.
SELECT NAME, EXTERNAL_NAME, LANGUAGE, WLM_ENVIRONMENT
  FROM SYSIBM.SYSROUTINES WHERE NAME = 'HASHUD';

-- 3. Call it. Expected digests (SHA-256, uppercase hex):
--      'password' -> 5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8
--      'test'     -> 9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08
--    Compare HASH_OUT with those values - a match proves the whole chain
--    (Db2 -> WLM address space -> COBOL -> ICSF CSNBOWH) is correct.
CALL BANKAPP.HASHUD('password', ?, ?, ?);

-- From a JDBC/ODBC client use a CallableStatement instead:
--   CALL BANKAPP.HASHUD(?, ?, ?, ?)
--   setString(1, plaintext); registerOutParameter(2, CHAR);
--   registerOutParameter(3, INTEGER); registerOutParameter(4, INTEGER)
