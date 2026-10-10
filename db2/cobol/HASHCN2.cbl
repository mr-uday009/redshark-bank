      ******************************************************************
      * HASHCN2 - same as HASHCONST but declares the input parameter *
      * as a FLAT PIC X(100) with no 2-byte length prefix.             *
      *                                                                *
      * Why: IBM's "Example of GENERAL linkage convention" shows *
      *     IN V1 INT, OUT V2 CHAR(9) *
      *        01 V1  PIC S9(9) USAGE COMP. *
      *        01 V2  PIC X(9). *
      * - a flat picture for a character parameter.  It does not show *
      * VARCHAR parameter at all. *
      *                                                                *
      * HASHCONST (with the length-prefixed group) returns SQLCODE -42 *
      * even though it never reads the input, which means the paramete *
      * OFFSETS are wrong - i.e. the length prefix we assumed is not *
      * actually there, so the OUT parameters sit at the wrong address *
      *                                                                *
      * If this one returns the constant cleanly, the fix is to drop t *
      * length prefix.  If it also fails, the problem is elsewhere. *
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. HASHCN2.

       DATA DIVISION.

       WORKING-STORAGE SECTION.

       01  WS-CONST                 PIC X(64).

       LINKAGE SECTION.

      *    Flat character parameter - no length prefix.
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
