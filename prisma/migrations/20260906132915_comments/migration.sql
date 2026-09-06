-- CreateTable
CREATE TABLE "CommentThread" (
    "id" TEXT NOT NULL,
    "diagramId" TEXT NOT NULL,
    "nodeId" TEXT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommentThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommentThread_diagramId_resolved_idx" ON "CommentThread"("diagramId", "resolved");

-- CreateIndex
CREATE INDEX "CommentThread_createdById_idx" ON "CommentThread"("createdById");

-- CreateIndex
CREATE INDEX "Comment_threadId_createdAt_idx" ON "Comment"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- AddForeignKey
ALTER TABLE "CommentThread" ADD CONSTRAINT "CommentThread_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentThread" ADD CONSTRAINT "CommentThread_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

