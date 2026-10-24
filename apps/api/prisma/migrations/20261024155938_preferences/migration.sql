-- CreateEnum
CREATE TYPE "PreferenceSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "PreferenceValue" AS ENUM ('PREFERRED', 'AVOID');

-- CreateTable
CREATE TABLE "preferences" (
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "slot" "PreferenceSlot" NOT NULL,
    "value" "PreferenceValue" NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("membership_id","weekday","slot")
);

-- CreateIndex
CREATE INDEX "preferences_organization_id_idx" ON "preferences"("organization_id");

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only constraint (not expressible in Prisma); future migrations must not drop it.
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6);
