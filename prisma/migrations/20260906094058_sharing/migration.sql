-- AlterTable
ALTER TABLE "Diagram" ADD COLUMN     "shareToken" TEXT;

-- CreateTable
CREATE TABLE "DiagramMember" (
    "id" TEXT NOT NULL,
    "diagramId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagramMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagramMember_userId_idx" ON "DiagramMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DiagramMember_diagramId_userId_key" ON "DiagramMember"("diagramId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Diagram_shareToken_key" ON "Diagram"("shareToken");

-- AddForeignKey
ALTER TABLE "DiagramMember" ADD CONSTRAINT "DiagramMember_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagramMember" ADD CONSTRAINT "DiagramMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

