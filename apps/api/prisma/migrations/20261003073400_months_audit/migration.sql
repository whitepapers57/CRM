-- CreateTable
CREATE TABLE "Month" (
    "month" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3),

    CONSTRAINT "Month_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_target_at_idx" ON "AuditLog"("target", "at");

-- CreateIndex
CREATE INDEX "AuditLog_action_at_idx" ON "AuditLog"("action", "at");
