-- CreateTable
CREATE TABLE "DiagramVersion" (
    "id" TEXT NOT NULL,
    "diagramId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "label" TEXT,

    CONSTRAINT "DiagramVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagramVersion_diagramId_createdAt_idx" ON "DiagramVersion"("diagramId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DiagramVersion_createdById_idx" ON "DiagramVersion"("createdById");

-- AddForeignKey
ALTER TABLE "DiagramVersion" ADD CONSTRAINT "DiagramVersion_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagramVersion" ADD CONSTRAINT "DiagramVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

