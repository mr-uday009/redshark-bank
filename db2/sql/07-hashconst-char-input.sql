-- ===========================================================================
-- BANKAPP.HASHCONST - CHAR(100) input variant
-- ===========================================================================
--
-- Diagnostic twin of BANKAPP.HASHUD.  Same signature and same linkage, but the
-- load module returns a fixed constant and never calls ICSF.  Use it to tell
-- whether a failure is in the DB2 <-> COBOL parameter linkage or in the ICSF
-- call itself.
--
-- The input is declared CHAR(100) rather than VARCHAR(100) for the same reason
-- as HASHUD: a flat PIC X(100) is a single pointer under GENERAL linkage, so
-- the following OUT parameters cannot be shifted out of position.
--
-- Build cobol/HASHCONST.cbl as member HASHCNST (8-character limit) with
-- jcl/BUILD-HASHCONST.jcl, then run this.
-- ===========================================================================

DROP PROCEDURE BANKAPP.HASHCONST;

CREATE PROCEDURE BANKAPP.HASHCONST
    (IN  PLAIN_TEXT     CHAR(100),
     OUT HASH_OUT       CHAR(64),
     OUT RETURN_CODE    INTEGER,
     OUT REASON_CODE    INTEGER)
    LANGUAGE COBOL
    PARAMETER STYLE GENERAL
    EXTERNAL NAME HASHCNST
    WLM ENVIRONMENT DB9GENV1
    COMMIT ON RETURN YES
    NO SQL;

GRANT EXECUTE ON PROCEDURE BANKAPP.HASHCONST TO PUBLIC;

SELECT NAME, EXTERNAL_NAME, LANGUAGE, WLM_ENVIRONMENT
  FROM SYSIBM.SYSROUTINES WHERE NAME = 'HASHCONST';

-- ===========================================================================
-- Expected result once the linkage is right:
--
--   HASH_OUT    = ABCDEF0123456789ABCDEF0123456789
--                 9876543210FEDCBA9876543210FEDCBA
--   RETURN_CODE = 0
--   REASON_CODE = 0
--
-- If you get that, the linkage is correct and any remaining HASHUD failure is
-- in the ICSF call.  If you still get SQLCODE -4220 / -330, the linkage model
-- is different from what we assumed and the next step is an external FUNCTION
-- (RETURNS CHAR(64)) instead of a procedure, so there are no OUT parameters.
-- ===========================================================================
