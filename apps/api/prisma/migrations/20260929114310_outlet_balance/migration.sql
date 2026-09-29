-- CreateTable
CREATE TABLE "OutletBalance" (
    "sdId" TEXT NOT NULL,
    "name" TEXT,
    "debt" DECIMAL(18,2) NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletBalance_pkey" PRIMARY KEY ("sdId")
);
