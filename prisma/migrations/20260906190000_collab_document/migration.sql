-- CreateTable
CREATE TABLE "DiagramDoc" (
    "diagramId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagramDoc_pkey" PRIMARY KEY ("diagramId")
);

-- AddForeignKey
ALTER TABLE "DiagramDoc" ADD CONSTRAINT "DiagramDoc_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

