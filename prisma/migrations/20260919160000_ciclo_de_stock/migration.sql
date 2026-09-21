-- CreateEnum
CREATE TYPE "EstadoStockPedido" AS ENUM ('RESERVADO', 'CONSUMIDO', 'LIBERADO');

-- AlterEnum
ALTER TYPE "EstadoPedido" ADD VALUE 'DEVUELTO';

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "stockEstado" "EstadoStockPedido" NOT NULL DEFAULT 'RESERVADO';

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_pagoReferencia_key" ON "Pedido"("pagoReferencia");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_sku_key" ON "Producto"("sku");

