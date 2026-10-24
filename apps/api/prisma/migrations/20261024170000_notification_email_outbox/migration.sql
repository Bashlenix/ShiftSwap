-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "email_dispatched_at" TIMESTAMPTZ(3);

-- Existing rows predate email delivery: mark them dispatched so nothing old is emailed.
UPDATE "notifications" SET "email_dispatched_at" = "created_at";

-- SQL-only partial index (not expressible in Prisma); future migrations must not drop it.
-- Serves the outbox claim: pending rows in (created_at, id) order.
CREATE INDEX "notifications_email_pending_idx" ON "notifications" ("created_at", "id") WHERE "email_dispatched_at" IS NULL;
