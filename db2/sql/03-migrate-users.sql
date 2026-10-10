-- ===========================================================================
-- Data migration: the two existing rows from the local PostgreSQL mirror
-- (auth_users / bank_accounts) into BANKAPP.USERS / BANKAPP.ACCOUNTS.
--
-- The password hashes are copied verbatim. They are SHA-256 digests in
-- uppercase hex, byte-identical to what ICSF CSNBOWH produces, so the
-- migrated users can still sign in once BANKAPP.HASHUD is callable.
--
--   testuser / test@example.com          / Test User
--   Redbob   / udaydharmavarapu008@...   / Uday
-- ===========================================================================

INSERT INTO BANKAPP.USERS (ID, USERNAME, EMAIL, FULL_NAME, PASSWORD_HASH, CREATED_AT)
VALUES (1, 'testuser', 'test@example.com', 'Test User',
        'B55C8792D1CE458E279308835F8A97B580263503E76E1998E279703E35AD0C2E',
        '2026-09-14-08.59.17.997000');

INSERT INTO BANKAPP.USERS (ID, USERNAME, EMAIL, FULL_NAME, PASSWORD_HASH, CREATED_AT)
VALUES (2, 'Redbob', 'udaydharmavarapu008@gmail.com', 'Uday',
        '6AAF9125E230CC4F4A31DAA67606D9FBF26C1B5616D8725921C312AB79DC2944',
        '2026-09-14-09.02.27.735000');

INSERT INTO BANKAPP.ACCOUNTS (ID, USER_ID, ACCOUNT_NUMBER, ACCOUNT_TYPE, BALANCE, CREATED_AT)
VALUES (1, 1, '545931603891', 'CHECKING', 9438.00, '2026-09-14-08.59.17.999000');

INSERT INTO BANKAPP.ACCOUNTS (ID, USER_ID, ACCOUNT_NUMBER, ACCOUNT_TYPE, BALANCE, CREATED_AT)
VALUES (2, 2, '086419409505', 'CHECKING', 19677.00, '2026-09-14-09.02.27.737000');

SELECT ID, USERNAME, EMAIL, FULL_NAME, PASSWORD_HASH FROM BANKAPP.USERS ORDER BY ID;
SELECT ID, USER_ID, ACCOUNT_NUMBER, BALANCE FROM BANKAPP.ACCOUNTS ORDER BY ID;
