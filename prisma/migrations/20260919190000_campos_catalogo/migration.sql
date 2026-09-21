-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "descripcionCorta" TEXT,
ADD COLUMN     "descripcionLarga" TEXT,
ADD COLUMN     "imagenAlt" TEXT,
ADD COLUMN     "imagenes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "modelo" TEXT,
ADD COLUMN     "subcategoria" TEXT,
ADD COLUMN     "tipoProducto" TEXT;
