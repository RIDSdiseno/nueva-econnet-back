-- CreateEnum
CREATE TYPE "EstadoCotizacion" AS ENUM ('ENVIADA', 'VISTA', 'ACEPTADA', 'PERDIDA', 'CADUCADA');

-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "actualizado" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "descuento" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estado" "EstadoCotizacion" NOT NULL DEFAULT 'ENVIADA',
ADD COLUMN     "huecos" JSONB NOT NULL,
ADD COLUMN     "iva" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "neto" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "numero" TEXT NOT NULL,
ADD COLUMN     "propuesta" JSONB NOT NULL,
ADD COLUMN     "proximoCorreo" TIMESTAMP(3),
ADD COLUMN     "seguimiento" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "validaHasta" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_numero_key" ON "Cotizacion"("numero");

-- CreateIndex
CREATE INDEX "Cotizacion_estado_proximoCorreo_idx" ON "Cotizacion"("estado", "proximoCorreo");

