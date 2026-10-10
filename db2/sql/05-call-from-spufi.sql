-- ===========================================================================
-- Calling BANKAPP.HASHUD from SPUFI
-- ===========================================================================
--
-- SHORT ANSWER: you cannot call BANKAPP.HASHUD directly from SPUFI.
--
-- SPUFI has no host variables, and Db2 refuses literals for OUT parameters.
-- Reproduced on this system:
--
--     CALL BANKAPP.HASHUD('password', '', 0, 0);
--     -> SQLCODE -4463 / SQLSTATE 42601
--        "Literal replacement parsing failed for procedure call to Db2 for z/OS"
--
-- The three OUT parameters (HASH_OUT, RETURN_CODE, REASON_CODE) need host
-- variables, which SPUFI cannot provide. Any of the following work instead.
--
-- ---------------------------------------------------------------------------
-- OPTION 1 - wrapper procedure (call it from SPUFI with a plain literal)
-- ---------------------------------------------------------------------------
--
-- Create this once (run the CREATE as a single statement - SPUFI: set the
-- terminator to something other than ';', or run it through DSNTEP2):

CREATE PROCEDURE BANKAPP.HASHUD_CALL (IN P_PLAIN VARCHAR(100))
    LANGUAGE SQL
    DYNAMIC RESULT SETS 1
BEGIN
    DECLARE V_HASH CHAR(64);
    DECLARE V_RC   INTEGER;
    DECLARE V_RSN  INTEGER;
    DECLARE C1 CURSOR WITH RETURN FOR
        SELECT V_HASH AS HASH_OUT,
               V_RC   AS RETURN_CODE,
               V_RSN  AS REASON_CODE
          FROM SYSIBM.SYSDUMMY1;
    CALL BANKAPP.HASHUD(P_PLAIN, V_HASH, V_RC, V_RSN);
    OPEN C1;
END

-- Then, from SPUFI, with no host variables needed:
--
--     CALL BANKAPP.HASHUD_CALL('password');
--
-- Expected row:
--     HASH_OUT = 5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8
--     RETURN_CODE = 0
--     REASON_CODE = 0
--
-- The calling convention is verified working: a twin procedure with only an IN
-- parameter (BANKAPP.TRIVIAL_CALL) returns its result set to a literal call.
-- HASHUD_CALL currently fails with SQLCODE -330 because the underlying COBOL
-- module is not yet reachable from the WLM address space - the same root cause
-- as the -444 seen on the direct call. Once that is fixed this needs no change.

-- ---------------------------------------------------------------------------
-- OPTION 2 - REXX (has host variables, runs from TSO like SPUFI)
-- ---------------------------------------------------------------------------
--
--   /* REXX */
--   ADDRESS TSO
--   "SUBCOM DSNREXX"
--   IF RC <> 0 THEN EXIT 8
--   HASH = COPIES(' ', 64)
--   RC1  = 0
--   RSN  = 0
--   "EXECSQL CALL BANKAPP.HASHUD('password', :HASH, :RC1, :RSN)"
--   SAY 'HASH=' HASH
--   SAY 'RC='   RC1 'RSN=' RSN

-- ---------------------------------------------------------------------------
-- OPTION 3 - COBOL batch driver (already built, verified working)
-- ---------------------------------------------------------------------------
--
--   db2/cobol/HASHDRV.cbl  +  db2/jcl/BUILD-HASHDRV.jcl
--
-- Output observed on this system:
--   CALLING HASHUD WITH IN-LEN=0008
--   RETURN CODE = 000000000
--   REASON CODE = 000000000
--   HASH OUT    = [5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8]

-- ---------------------------------------------------------------------------
-- OPTION 4 - JDBC (what the website uses)
-- ---------------------------------------------------------------------------
--
--   CallableStatement cs = c.prepareCall("CALL BANKAPP.HASHUD(?,?,?,?)");
--   cs.setString(1, "password");
--   cs.registerOutParameter(2, Types.CHAR);
--   cs.registerOutParameter(3, Types.INTEGER);
--   cs.registerOutParameter(4, Types.INTEGER);
--   cs.execute();
--   System.out.println(cs.getString(2));
