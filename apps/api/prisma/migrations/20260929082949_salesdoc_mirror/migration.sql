-- CreateTable
CREATE TABLE "PaymentType" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "short" TEXT,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentType_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Cashbox" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cashbox_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Agent" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Expeditor" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expeditor_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Product" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "packQuantity" INTEGER,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "sdId" TEXT NOT NULL,
    "warehouseSdId" TEXT NOT NULL,
    "productSdId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "firmName" TEXT,
    "inn" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL,
    "expeditorSdId" TEXT,
    "updatedAtSd" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "updatedAtSd" TIMESTAMP(3),
    "warehouseSdId" TEXT,
    "supplierSdId" TEXT,
    "total" DECIMAL(18,2) NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" SERIAL NOT NULL,
    "purchaseSdId" TEXT NOT NULL,
    "productSdId" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "status" INTEGER NOT NULL,
    "dateDocument" TIMESTAMP(3) NOT NULL,
    "dateCreate" TIMESTAMP(3),
    "dateDelivered" TIMESTAMP(3),
    "totalSumma" DECIMAL(18,2) NOT NULL,
    "discountSumma" DECIMAL(18,2) NOT NULL,
    "totalAfterDiscount" DECIMAL(18,2) NOT NULL,
    "totalReturnsSumma" DECIMAL(18,2) NOT NULL,
    "debtDateExp" DATE,
    "outletSdId" TEXT,
    "agentSdId" TEXT,
    "expeditorSdId" TEXT,
    "warehouseSdId" TEXT,
    "paymentTypeSdId" TEXT,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" SERIAL NOT NULL,
    "orderSdId" TEXT NOT NULL,
    "productSdId" TEXT,
    "productName" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL,
    "summa" DECIMAL(18,2) NOT NULL,
    "returned" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletReturn" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "status" INTEGER NOT NULL,
    "dateDocument" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "outletSdId" TEXT,
    "agentSdId" TEXT,
    "expeditorSdId" TEXT,
    "warehouseSdId" TEXT,
    "reason" TEXT,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletReturn_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" SERIAL NOT NULL,
    "returnSdId" TEXT NOT NULL,
    "productSdId" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "summa" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "transactionType" INTEGER NOT NULL,
    "paymentTypeSdId" TEXT,
    "outletSdId" TEXT,
    "agentSdId" TEXT,
    "cashboxSdId" TEXT,
    "comment" TEXT,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("sdId")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" SERIAL NOT NULL,
    "paymentSdId" TEXT NOT NULL,
    "orderSdId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "resource" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "fullStartedAt" TIMESTAMP(3),
    "nextPage" INTEGER,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("resource")
);

-- CreateIndex
CREATE INDEX "StockLevel_warehouseSdId_idx" ON "StockLevel"("warehouseSdId");

-- CreateIndex
CREATE INDEX "Purchase_date_idx" ON "Purchase"("date");

-- CreateIndex
CREATE INDEX "PurchaseLine_purchaseSdId_idx" ON "PurchaseLine"("purchaseSdId");

-- CreateIndex
CREATE INDEX "Order_outletSdId_status_dateDocument_idx" ON "Order"("outletSdId", "status", "dateDocument");

-- CreateIndex
CREATE INDEX "Order_dateDocument_idx" ON "Order"("dateDocument");

-- CreateIndex
CREATE INDEX "OrderLine_orderSdId_idx" ON "OrderLine"("orderSdId");

-- CreateIndex
CREATE INDEX "OutletReturn_outletSdId_status_dateDocument_idx" ON "OutletReturn"("outletSdId", "status", "dateDocument");

-- CreateIndex
CREATE INDEX "ReturnLine_returnSdId_idx" ON "ReturnLine"("returnSdId");

-- CreateIndex
CREATE INDEX "Payment_outletSdId_transactionType_paymentDate_idx" ON "Payment"("outletSdId", "transactionType", "paymentDate");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentSdId_idx" ON "PaymentAllocation"("paymentSdId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_orderSdId_idx" ON "PaymentAllocation"("orderSdId");

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseSdId_fkey" FOREIGN KEY ("purchaseSdId") REFERENCES "Purchase"("sdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderSdId_fkey" FOREIGN KEY ("orderSdId") REFERENCES "Order"("sdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnSdId_fkey" FOREIGN KEY ("returnSdId") REFERENCES "OutletReturn"("sdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentSdId_fkey" FOREIGN KEY ("paymentSdId") REFERENCES "Payment"("sdId") ON DELETE CASCADE ON UPDATE CASCADE;
