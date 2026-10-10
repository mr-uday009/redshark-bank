-- ===========================================================================
-- BANKAPP.HASHUD - external stored procedure that hashes a password with
-- ICSF (CSNBOWH, SHA-256) and returns the 64-character uppercase hex digest.
--
-- Prerequisites
--   1. cobol/HASHUD.cbl compiled and link-edited as load module HASHUD into a
--      library that is in the STEPLIB of the WLM stored-procedure address
--      space (see jcl/BUILD-HASHUD.jcl).
--   2. A WLM application environment of subsystem type DB2 to run it in
--      (see wlm/README.md).
--   3. CSF.SCSFMOD0 (ICSF callable services) reachable by that address space.
--      On this system it is already in the LNKLST, so no STEPLIB entry is
--      needed; otherwise add it to the STEPLIB.
--
-- WLM ENVIRONMENT
--   The environment name must match an application environment that is
--   actually defined in the ACTIVE WLM service definition AND whose JCL
--   procedure is in the JES2 procedure-library concatenation.
--   This ADCD system defines DB9GENV1 (procedure DB9GWLM1, shipped in
--   DSN910.PROCLIB).  Because DSN910.PROCLIB is NOT in the JES2 PROC00
--   concatenation, DB9GWLM1 must first be copied into a library that is
--   (USER.PROCLIB / ADCD.Z111S.PROCLIB) - see wlm/README.md.
--   Substitute WLMENV1 below if you have defined your own environment.
-- ===========================================================================

CREATE PROCEDURE BANKAPP.HASHUD
    (IN  PLAIN_TEXT     VARCHAR(100),
     OUT HASH_OUT       CHAR(64),
     OUT RETURN_CODE    INTEGER,
     OUT REASON_CODE    INTEGER)
    LANGUAGE COBOL
    PARAMETER STYLE GENERAL
    EXTERNAL NAME HASHUD
    WLM ENVIRONMENT DB9GENV1
    COMMIT ON RETURN YES
    NO SQL;

-- Allow the application's DB2 user to invoke it.
GRANT EXECUTE ON PROCEDURE BANKAPP.HASHUD TO PUBLIC;

-- Show what was registered.
SELECT NAME, EXTERNAL_NAME, LANGUAGE, WLM_ENVIRONMENT, PARM_COUNT
  FROM SYSIBM.SYSROUTINES
 WHERE NAME = 'HASHUD';
