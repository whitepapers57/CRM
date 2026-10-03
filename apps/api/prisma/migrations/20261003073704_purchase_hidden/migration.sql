-- CreateTable
CREATE TABLE "PurchaseHidden" (
    "purchaseSdId" TEXT NOT NULL,
    "hiddenById" TEXT NOT NULL,
    "hiddenByName" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "PurchaseHidden_pkey" PRIMARY KEY ("purchaseSdId")
);
