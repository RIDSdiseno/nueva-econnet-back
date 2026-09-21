-- Tres cosas que el panel necesita para que el negocio se gobierne solo:
-- el coste de compra (para saber el margen), los ajustes editables sin
-- desplegar, y las fotografías.

ALTER TABLE "Producto" ADD COLUMN "costoNeto" INTEGER;

CREATE TABLE "Ajuste" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "autor" TEXT NOT NULL DEFAULT 'panel',
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ajuste_pkey" PRIMARY KEY ("clave")
);

CREATE TABLE "Medio" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "datos" BYTEA NOT NULL,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Medio_pkey" PRIMARY KEY ("id")
);
