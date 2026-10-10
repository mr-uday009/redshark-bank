-- ===========================================================================
-- BANKAPP.HASHUD - FINAL, WORKING definition
-- ===========================================================================
--
-- THE FIX WAS ONE LINE:  PARAMETER CCSID EBCDIC
--
-- Without it, every call failed with:
--     JDBC : SQLCODE -4220  CharConversionException
--     SQL  : SQLCODE -330   invalid character data
-- and the whole stored-procedure feature looked broken.
--
-- WHY
-- ---
-- A COBOL program writes EBCDIC into its output parameters.  Without
-- PARAMETER CCSID, Db2 does not know that, so it passes the EBCDIC bytes
-- straight through to the client instead of converting them.  The client then
-- tries to decode 0xC1 0xC2 ... as UTF-8, which is invalid, and throws.
--
-- Telling Db2 the parameters are EBCDIC makes it convert properly on the way
-- out.  Measured on this system, with the SAME load module:
--
--     (no PARAMETER CCSID)      -> SQLCODE -4220
--     PARAMETER CCSID EBCDIC    -> correct digest      <-- use this
--     PARAMETER CCSID ASCII     -> wrong characters
--     PARAMETER CCSID UNICODE   -> SQLCODE -4220
--
-- This was NOT a linkage problem.  The VARCHAR(100) input declaration was
-- correct all along; a CHAR(100) variant also works, but the change is
-- unnecessary.  Everything else that was tried - APF authorization, WLM
-- policy, COMMIT ON RETURN, driver version, ccsid= URL properties - either
-- fixed a real but different problem (WLM, APF) or changed nothing.
-- ===========================================================================

DROP PROCEDURE BANKAPP.HASHUD;

CREATE PROCEDURE BANKAPP.HASHUD
    (IN  PLAIN_TEXT     VARCHAR(100),
     OUT HASH_OUT       CHAR(64),
     OUT RETURN_CODE    INTEGER,
     OUT REASON_CODE    INTEGER)
    LANGUAGE COBOL
    PARAMETER STYLE GENERAL
    PARAMETER CCSID EBCDIC
    EXTERNAL NAME HASHUD
    WLM ENVIRONMENT DB9GENV1
    COMMIT ON RETURN YES
    NO SQL;

GRANT EXECUTE ON PROCEDURE BANKAPP.HASHUD TO PUBLIC;

SELECT NAME, EXTERNAL_NAME, LANGUAGE, WLM_ENVIRONMENT
  FROM SYSIBM.SYSROUTINES WHERE NAME = 'HASHUD';

-- ===========================================================================
-- Verified results (module: cobol/HASHUD.cbl, VARCHAR(100) version)
--
--   'password'  -> 5E884898DA28047151D0E56F8DC6292773603D0D6AABBDD62A11EF721D1542D8
--   'test'      -> 9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08
--   'Test User' -> 9E95A89B42F1FB5A3EA9F8657EC45354A080B57B8EF2F6DF85B73ADD1F756465
--   all with return code 0 and reason code 0, and all matching Python's
--   hashlib.sha256(pw.encode()).hexdigest() exactly.
--
-- The website was then exercised end to end: registering a user stored the
-- ICSF-computed digest in BANKAPP.USERS, GET /api/db2/status reported
-- "engine":"icsf", and logging in with that password succeeded while a wrong
-- password was rejected.
-- ===========================================================================
