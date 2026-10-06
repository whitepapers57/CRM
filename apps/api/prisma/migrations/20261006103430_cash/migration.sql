-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTypeAccount" (
    "paymentTypeSdId" TEXT NOT NULL,
    "account" TEXT NOT NULL,

    CONSTRAINT "PaymentTypeAccount_pkey" PRIMARY KEY ("paymentTypeSdId")
);

-- CreateTable
CREATE TABLE "CashOperation" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "direction" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "cashboxSdId" TEXT,
    "bankAccountId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "operation" TEXT NOT NULL,
    "supplierSdId" TEXT,
    "outletSdId" TEXT,
    "categoryId" TEXT,
    "counterpartyName" TEXT,
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByName" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "CashOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashOperation_seq_key" ON "CashOperation"("seq");

-- CreateIndex
CREATE INDEX "CashOperation_account_direction_date_idx" ON "CashOperation"("account", "direction", "date");

-- CreateIndex
CREATE INDEX "CashOperation_supplierSdId_date_idx" ON "CashOperation"("supplierSdId", "date");

INSERT INTO "BankAccount" ("id", "name") VALUES (gen_random_uuid()::text, 'Основной счёт');
INSERT INTO "CashCategory" ("id", "name", "kind") VALUES (gen_random_uuid()::text, 'Прочие расходы', 'expense'), (gen_random_uuid()::text, 'Прочие доходы', 'income');
