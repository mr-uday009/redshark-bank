      ******************************************************************
      * HASHCONST - identical Db2 linkage to HASHUD, but returns a     *
      * fixed constant instead of calling ICSF.                        *
      *                                                                *
      * Purpose: separate "is the Db2 <-> COBOL parameter linkage *
      * correct?" from "is the ICSF output the problem?".  If this *
      * returns the constant cleanly, the linkage is fine. *
      *                                                                *
      * SAME CHANGE AS HASHUD: the input is declared as a FLAT *
      * PIC X(100) for CHAR(100), not a length-prefixed VARCHAR group. *
      *                                                                *
      * Why: under GENERAL linkage the parameters arrive as a LIST OF *
      * POINTERS.  If Db2 passes a VARCHAR as TWO pointers (length, *
      * then data) while the program declares one item, every later *
      * parameter shifts by one and the OUT areas are written to the *
      * wrong place - which shows up as SQLCODE -4220 (client) and *
      * -330 (server).  A flat CHAR parameter is a single pointer, so *
      * nothing can shift. *
      *                                                                *
      * Register as:                                                   *
      *   CREATE PROCEDURE BANKAPP.HASHCONST *
      *       (IN PLAIN_TEXT CHAR(100), *
      *        OUT HASH_OUT CHAR(64), *
      *        OUT RETURN_CODE INTEGER, *
      *        OUT REASON_CODE INTEGER) *
      *       LANGUAGE COBOL PARAMETER STYLE GENERAL *
      *       EXTERNAL NAME HASHCNST *
      *       WLM ENVIRONMENT DB9GENV1 NO SQL; *
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. HASHCONST.

       DATA DIVISION.

       WORKING-STORAGE SECTION.

       01  WS-CONST                 PIC X(64).

       LINKAGE SECTION.

      *    Flat character parameter - single pointer, no length prefix.
       01  LS-INPUT-TEXT            PIC X(100).

       01  LS-HASH-OUTPUT           PIC X(64).
       01  LS-RETURN-CODE           PIC S9(9) COMP.
       01  LS-REASON-CODE           PIC S9(9) COMP.

       PROCEDURE DIVISION USING LS-INPUT-TEXT
                                 LS-HASH-OUTPUT
                                 LS-RETURN-CODE
                                 LS-REASON-CODE.

       MAIN-PROCESS.
           MOVE 'ABCDEF0123456789ABCDEF0123456789' TO WS-CONST(1:32)
           MOVE '9876543210FEDCBA9876543210FEDCBA' TO WS-CONST(33:32)

           MOVE WS-CONST TO LS-HASH-OUTPUT
           MOVE 0 TO LS-RETURN-CODE
           MOVE 0 TO LS-REASON-CODE
           GOBACK.
