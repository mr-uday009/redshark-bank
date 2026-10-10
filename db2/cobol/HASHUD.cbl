      ******************************************************************
      * HASHUD  - Db2 for z/OS external stored procedure              *
      *           SHA-256 password hashing performed by ICSF          *
      *                                                               *
      * Invoked by the bank application as:                           *
      *     CALL BANKAPP.HASHUD(?, ?, ?, ?)                           *
      *                                                               *
      * IN  : PLAIN_TEXT   VARCHAR(100)                               *
      * OUT : HASH_OUT     CHAR(64)    uppercase hex SHA-256 digest   *
      * OUT : RETURN_CODE  INTEGER     ICSF return code (0 = success) *
      * OUT : REASON_CODE  INTEGER     ICSF reason code               *
      *                                                               *
      * TWO THINGS THIS PROGRAM HAS TO GET RIGHT                      *
      *                                                               *
      * 1. PARAMETER MAPPING                                          *
      *    Db2 passes a VARCHAR(n) parameter to COBOL as a 2-byte     *
      *    binary length followed by n bytes of character data.       *
      *    Declaring it as a flat PIC X(100) loses the length and     *
      *    forces the program to guess it.                            *
      *                                                               *
      * 2. CHARACTER ENCODING - THE SUBTLE ONE                        *
      *    Db2 hands us EBCDIC.  ICSF hashes whatever bytes it is     *
      *    given, so hashing the EBCDIC text directly produces a      *
      *    digest of the EBCDIC bytes.  Measured on this system:      *
      *        ICSF('password' as EBCDIC) = 61E9F866F42264B1...       *
      *        SHA-256('password' ASCII)  = 5E884898DA2804715...      *
      *    Every other tier - the browser, Node's crypto, the         *
      *    PostgreSQL mirror, and the hashes already stored in        *
      *    BANKAPP.USERS - uses the ASCII/UTF-8 bytes.  So the text   *
      *    MUST be converted EBCDIC -> ASCII before it reaches ICSF,  *
      *    otherwise every existing password stops matching and the   *
      *    two systems can never agree.                               *
      *                                                               *
      *    The conversion uses the COBOL code-page intrinsics:        *
      *        NATIONAL-OF(text, 037)  EBCDIC 037 -> national (UTF-16)*
      *        DISPLAY-OF(nat, 819)    national   -> ISO-8859-1       *
      *    ISO-8859-1 is byte-identical to UTF-8 for every character  *
      *    a password realistically contains, so the resulting digest *
      *    matches Node's sha256(utf8(password)).                     *
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. HASHUD.

       ENVIRONMENT DIVISION.

       DATA DIVISION.

       WORKING-STORAGE SECTION.

      *****************************************************************
      * ICSF CSNBOWH PARAMETERS                                       *
      *****************************************************************
       01  ICSF-EXIT-DATA-LEN       PIC S9(9) COMP VALUE 0.
       01  ICSF-EXIT-DATA           PIC X(4)  VALUE SPACES.

       01  ICSF-RULE-COUNT          PIC S9(9) COMP VALUE 2.
       01  ICSF-RULE-ARRAY.
           05 ICSF-RULE-1           PIC X(8) VALUE 'SHA-256 '.
           05 ICSF-RULE-2           PIC X(8) VALUE 'ONLY    '.

       01  CHAINING-VECTOR-LENGTH   PIC S9(9) COMP VALUE 128.
       01  CHAINING-VECTOR          PIC X(128) VALUE LOW-VALUES.

       01  HASH-OUTPUT-LEN          PIC S9(9) COMP VALUE 32.
       01  HASH-OUTPUT-BIN          PIC X(32) VALUE LOW-VALUES.

       01  HEX-TABLE.
           05 FILLER PIC X(16) VALUE '0123456789ABCDEF'.

       01  WS-INPUT-TEXT-LEN        PIC S9(9) COMP VALUE 0.
       01  WS-MAX-LEN               PIC S9(9) COMP VALUE 100.
       01  WS-IDX                   PIC S9(4) COMP.
       01  WS-NIBBLE                PIC S9(4) COMP.
       01  WS-BYTE                  PIC X.

      *****************************************************************
      * EBCDIC -> ASCII working area                                 *
      *****************************************************************
       01  WS-EBCDIC-TEXT           PIC X(100).
       01  WS-NATIONAL-TEXT         PIC N(100) USAGE NATIONAL.
       01  WS-ASCII-TEXT            PIC X(100).

       LINKAGE SECTION.

       01  LS-INPUT-TEXT.
           05 LS-INPUT-TEXT-LEN     PIC S9(4) COMP.
           05 LS-INPUT-TEXT-DATA    PIC X(100).

       01  LS-HASH-OUTPUT           PIC X(64).
       01  LS-RETURN-CODE           PIC S9(9) COMP.
       01  LS-REASON-CODE           PIC S9(9) COMP.

       PROCEDURE DIVISION USING LS-INPUT-TEXT
                                 LS-HASH-OUTPUT
                                 LS-RETURN-CODE
                                 LS-REASON-CODE.

       MAIN-PROCESS.
           MOVE SPACES TO LS-HASH-OUTPUT
           MOVE 0 TO LS-RETURN-CODE
           MOVE 0 TO LS-REASON-CODE

      *****************************************************************
      * Take the length straight from the VARCHAR length prefix.      *
      *****************************************************************
           MOVE LS-INPUT-TEXT-LEN TO WS-INPUT-TEXT-LEN

           IF WS-INPUT-TEXT-LEN < 0 OR WS-INPUT-TEXT-LEN > WS-MAX-LEN
              MOVE 8 TO LS-RETURN-CODE
              GOBACK
           END-IF

      *****************************************************************
      * Convert the EBCDIC password to ASCII so ICSF hashes exactly   *
      * the bytes every other tier would hash.                        *
      *****************************************************************
           MOVE LS-INPUT-TEXT-DATA TO WS-EBCDIC-TEXT
           MOVE FUNCTION NATIONAL-OF(WS-EBCDIC-TEXT, 037)
             TO WS-NATIONAL-TEXT
           MOVE FUNCTION DISPLAY-OF(WS-NATIONAL-TEXT, 819)
             TO WS-ASCII-TEXT

      *****************************************************************
      * CALL ICSF SHA-256 (one-way hash - CSNBOWH never decrypts)     *
      *****************************************************************
           CALL 'CSNBOWH' USING
                LS-RETURN-CODE
                LS-REASON-CODE
                ICSF-EXIT-DATA-LEN
                ICSF-EXIT-DATA
                ICSF-RULE-COUNT
                ICSF-RULE-ARRAY
                WS-INPUT-TEXT-LEN
                WS-ASCII-TEXT
                CHAINING-VECTOR-LENGTH
                CHAINING-VECTOR
                HASH-OUTPUT-LEN
                HASH-OUTPUT-BIN

           IF LS-RETURN-CODE NOT = 0
              GOBACK
           END-IF

      *****************************************************************
      * CONVERT THE 32 BINARY BYTES TO 64 UPPERCASE HEX CHARACTERS    *
      *****************************************************************
           PERFORM VARYING WS-IDX FROM 1 BY 1
                   UNTIL WS-IDX > HASH-OUTPUT-LEN

               MOVE HASH-OUTPUT-BIN(WS-IDX:1) TO WS-BYTE

               COMPUTE WS-NIBBLE =
                       (FUNCTION ORD(WS-BYTE) - 1) / 16
               MOVE HEX-TABLE(WS-NIBBLE + 1:1)
                 TO LS-HASH-OUTPUT((WS-IDX * 2) - 1:1)

               COMPUTE WS-NIBBLE =
                       FUNCTION MOD(FUNCTION ORD(WS-BYTE) - 1, 16)
               MOVE HEX-TABLE(WS-NIBBLE + 1:1)
                 TO LS-HASH-OUTPUT(WS-IDX * 2:1)

           END-PERFORM

           GOBACK.
