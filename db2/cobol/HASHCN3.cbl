      ******************************************************************
      * HASHCN3 - external COBOL procedure with ONE OUT parameter and *
      * NO input parameter at all.                                     *
      *                                                                *
      * Why: BANKAPP.TESTOUT (an SQL procedure with VARCHAR IN + *
      * CHAR(64) OUT + INTEGER OUT) works perfectly over JDBC, so OUT *
      * parameters and CHAR/INTEGER round-trip correctly.  The failure *
      * is therefore specific to the EXTERNAL COBOL linkage. *
      *                                                                *
      * This test removes the input parameter entirely, so if it fails *
      * too, the input declaration is not the cause.  If it succeeds, *
      * the VARCHAR(100) input declaration is the culprit. *
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. HASHCN3.

       DATA DIVISION.

       WORKING-STORAGE SECTION.

       01  WS-CONST                 PIC X(64).

       LINKAGE SECTION.

       01  LS-HASH-OUTPUT           PIC X(64).

       PROCEDURE DIVISION USING LS-HASH-OUTPUT.

       MAIN-PROCESS.
           MOVE 'ABCDEF0123456789ABCDEF0123456789' TO WS-CONST(1:32)
           MOVE '9876543210FEDCBA9876543210FEDCBA' TO WS-CONST(33:32)

           MOVE WS-CONST TO LS-HASH-OUTPUT
           GOBACK.
