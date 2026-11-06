-- 0002 · TRX_ID + IDEMPOTENCY_KEY on transactions
--
-- TRX_ID          unique 12-digit decimal identifier, the business PRIMARY KEY.
-- IDEMPOTENCY_KEY identifies the original payment request, shared by the SENT
--                 and RECEIVED rows of one transfer.
--
-- A single transfer writes two ledger rows, so idempotency is enforced per
-- (request, account): UNIQUE (idempotency_key, user_id) lets the sender and
-- the recipient each have one row, but stops either account from replaying
-- the same request.
--
-- Historical rows are backfilled deterministically:
--   trx_id          = 100000000000 + id   (exactly 12 digits, unique per row)
--   idempotency_key = reference           (the original request identifier)
-- Live payments draw 12-digit ids from transactions_trx_id_seq, which starts
-- at 200000000000 — a disjoint range, so it can never collide with a backfill.

CREATE SEQUENCE "public"."transactions_trx_id_seq" INCREMENT BY 1 MINVALUE 200000000000 MAXVALUE 999999999999 START WITH 200000000000 CACHE 1;--> statement-breakpoint
-- 1. Add as nullable first: NOT NULL columns cannot be added to a populated table.
ALTER TABLE "transactions" ADD COLUMN "trx_id" varchar(12);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "idempotency_key" varchar(36);--> statement-breakpoint
-- 2. Backfill every existing row.
UPDATE "transactions"
   SET "trx_id" = lpad((100000000000 + "id")::text, 12, '0'),
       "idempotency_key" = "reference";--> statement-breakpoint
-- 3. Enforce NOT NULL now that no row is empty.
ALTER TABLE "transactions" ALTER COLUMN "trx_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
-- 4. PRIMARY KEY moves from the surrogate id to trx_id, so the database itself
--    guarantees that no two transactions can share a transaction ID.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_pkey";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_trx_id_pk" PRIMARY KEY ("trx_id");--> statement-breakpoint
-- 5. Keep the surrogate id unique (history ordering + feed version probe).
CREATE UNIQUE INDEX "transactions_id_idx" ON "transactions" USING btree ("id");--> statement-breakpoint
-- 6. UNIQUE constraint: an account cannot reuse an idempotency key.
--    The sequence needs no setval(): its 200000000000 START range is disjoint
--    from the 100000000000+id values written by the backfill above.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_idempotency_uq" UNIQUE("idempotency_key","user_id");
