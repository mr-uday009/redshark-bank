      ******************************************************************
      * HASHDRV - test driver that calls HASHUD directly (no Db2).     *
      * Shows exactly what the stored procedure returns.               *
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. HASHDRV.

       DATA DIVISION.

       WORKING-STORAGE SECTION.

       01  IN-TEXT.
           05 IN-LEN                PIC S9(4) COMP VALUE 8.
           05 IN-DATA               PIC X(100) VALUE 'password'.

       01  OUT-HASH                 PIC X(64).
       01  OUT-RC                   PIC S9(9) COMP.
       01  OUT-RSN                  PIC S9(9) COMP.

       01  WS-DISP                  PIC 9(9).

       PROCEDURE DIVISION.

       MAIN-PROCESS.
           MOVE SPACES TO OUT-HASH
           MOVE 0 TO OUT-RC
           MOVE 0 TO OUT-RSN

           DISPLAY 'CALLING HASHUD WITH IN-LEN=' IN-LEN

           CALL 'HASHUD' USING IN-TEXT
                               OUT-HASH
                               OUT-RC
                               OUT-RSN

           MOVE OUT-RC TO WS-DISP
           DISPLAY 'RETURN CODE = ' WS-DISP
           MOVE OUT-RSN TO WS-DISP
           DISPLAY 'REASON CODE = ' WS-DISP
           DISPLAY 'HASH OUT    = [' OUT-HASH ']'

           STOP RUN.
