-- CreateTable
CREATE TABLE "DiagramImage" (
    "diagramId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,

    CONSTRAINT "DiagramImage_pkey" PRIMARY KEY ("diagramId","imageId")
);

-- CreateIndex
CREATE INDEX "DiagramImage_imageId_idx" ON "DiagramImage"("imageId");

-- AddForeignKey
ALTER TABLE "DiagramImage" ADD CONSTRAINT "DiagramImage_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagramImage" ADD CONSTRAINT "DiagramImage_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
