-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categorySdId" TEXT;

-- CreateTable
CREATE TABLE "ProductCategory" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("sdId")
);

-- Products already synced carry their category in the stored Salesdoc row.
UPDATE "Product" SET "categorySdId" = "raw"->'category'->>'SD_id';
