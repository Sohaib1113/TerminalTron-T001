-- CreateTable
CREATE TABLE "automation_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending-approval',
    "result" TEXT,
    "error" TEXT,
    "source" TEXT NOT NULL DEFAULT 'chat',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "automation_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "automation_audit_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "automation_tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "automation_tasks_userId_idx" ON "automation_tasks"("userId");

-- CreateIndex
CREATE INDEX "automation_tasks_status_idx" ON "automation_tasks"("status");

-- CreateIndex
CREATE INDEX "automation_audit_logs_userId_idx" ON "automation_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "automation_audit_logs_timestamp_idx" ON "automation_audit_logs"("timestamp");
