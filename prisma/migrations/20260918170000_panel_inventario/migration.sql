-- El panel de inventario: archivar sin borrar, y dejar rastro de cada cambio.

ALTER TABLE "Producto" ADD COLUMN "archivado" TIMESTAMP(3);
CREATE INDEX "Producto_archivado_idx" ON "Producto"("archivado");

CREATE TABLE "CambioProducto" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "antes" TEXT,
    "despues" TEXT,
    "motivo" TEXT,
    "autor" TEXT NOT NULL DEFAULT 'panel',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CambioProducto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CambioProducto_productoId_fecha_idx" ON "CambioProducto"("productoId", "fecha");
CREATE INDEX "CambioProducto_fecha_idx" ON "CambioProducto"("fecha");

ALTER TABLE "CambioProducto" ADD CONSTRAINT "CambioProducto_productoId_fkey"
    FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
