-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "headEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT,
    "groupKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "startTime" TEXT,
    "workdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminationReason" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminationReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birthDate" DATE,
    "birthPlace" TEXT,
    "nationality" TEXT,
    "citizenship" TEXT,
    "gender" TEXT,
    "passportSeries" TEXT,
    "passportNumber" TEXT,
    "passportIssuedBy" TEXT,
    "passportIssuedDate" DATE,
    "passportValidUntil" DATE,
    "pinfl" TEXT,
    "inn" TEXT,
    "address" TEXT,
    "educationLevel" TEXT,
    "departmentId" TEXT,
    "positionId" TEXT,
    "employmentType" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "workSchedule" JSONB,
    "rate" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "salary" INTEGER,
    "hiredAt" DATE,
    "orderNumber" TEXT,
    "orderDate" DATE,
    "experienceMonths" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeRelative" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "fullName" TEXT,
    "birthDate" DATE,
    "workplacePosition" TEXT,
    "residenceAddress" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeRelative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDiploma" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "degree" TEXT,
    "institution" TEXT,
    "specialty" TEXT,
    "enrolledYear" INTEGER,
    "graduatedYear" INTEGER,
    "seriesNumber" TEXT,
    "issuedDate" DATE,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDiploma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSalesdocAccount" (
    "kind" TEXT NOT NULL,
    "sdId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedById" TEXT NOT NULL,

    CONSTRAINT "EmployeeSalesdocAccount_pkey" PRIMARY KEY ("kind","sdId")
);

-- CreateTable
CREATE TABLE "Supervisor" (
    "sdId" TEXT NOT NULL,
    "csId" TEXT,
    "code1c" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supervisor_pkey" PRIMARY KEY ("sdId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_nameKey_key" ON "Department"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Position_groupKey_nameKey_key" ON "Position"("groupKey", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "TerminationReason_labelKey_key" ON "TerminationReason"("labelKey");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_pinfl_key" ON "Employee"("pinfl");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE INDEX "Employee_positionId_idx" ON "Employee"("positionId");

-- CreateIndex
CREATE INDEX "EmployeeRelative_employeeId_idx" ON "EmployeeRelative"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDiploma_employeeId_idx" ON "EmployeeDiploma"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeSalesdocAccount_employeeId_idx" ON "EmployeeSalesdocAccount"("employeeId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headEmployeeId_fkey" FOREIGN KEY ("headEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRelative" ADD CONSTRAINT "EmployeeRelative_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDiploma" ADD CONSTRAINT "EmployeeDiploma_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalesdocAccount" ADD CONSTRAINT "EmployeeSalesdocAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "TerminationReason" ("id", "label", "labelKey", "sortOrder") VALUES
  (gen_random_uuid()::text, 'По собственному желанию', 'по собственному желанию', 1),
  (gen_random_uuid()::text, 'По соглашению сторон', 'по соглашению сторон', 2),
  (gen_random_uuid()::text, 'Истечение срока договора', 'истечение срока договора', 3),
  (gen_random_uuid()::text, 'Несоответствие занимаемой должности', 'несоответствие занимаемой должности', 4),
  (gen_random_uuid()::text, 'Нарушение трудовой дисциплины', 'нарушение трудовой дисциплины', 5),
  (gen_random_uuid()::text, 'Сокращение штата', 'сокращение штата', 6);
