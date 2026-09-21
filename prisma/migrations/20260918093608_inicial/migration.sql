-- CreateEnum
CREATE TYPE "Condicion" AS ENUM ('NUEVO', 'OPENBOX', 'REACONDICIONADO', 'SEMINUEVO', 'USADO');

-- CreateEnum
CREATE TYPE "EstadoStock" AS ENUM ('EN_STOCK', 'LIMITADO', 'SIN_EXISTENCIAS', 'DESCONOCIDO');

-- CreateEnum
CREATE TYPE "Confianza" AS ENUM ('ALTA', 'MEDIA', 'BAJA');

-- CreateEnum
CREATE TYPE "EstadoCarrito" AS ENUM ('ABIERTO', 'VACIO', 'COMPRADO', 'PARADO', 'TERMINADA');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('POR_CONFIRMAR', 'PENDIENTE_PAGO', 'PAGADO', 'PREPARANDO', 'DESPACHADO', 'ENTREGADO', 'ANULADO', 'REVISAR');

-- CreateEnum
CREATE TYPE "ModoDespacho" AS ENUM ('DESPACHO', 'RETIRO');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('BOLETA', 'FACTURA');

-- CreateEnum
CREATE TYPE "TipoCupon" AS ENUM ('PORCENTAJE', 'MONTO');

-- CreateEnum
CREATE TYPE "EstadoCorreo" AS ENUM ('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'FALLADO');

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT,
    "marca" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "condicion" "Condicion",
    "garantia" TEXT,
    "precioLista" INTEGER,
    "precioVenta" INTEGER,
    "precioFalabella" INTEGER,
    "precioLider" INTEGER,
    "stockEstado" "EstadoStock" NOT NULL DEFAULT 'DESCONOCIDO',
    "stockUnidades" INTEGER,
    "reservadas" INTEGER NOT NULL DEFAULT 0,
    "specs" JSONB NOT NULL,
    "usos" TEXT[],
    "valores" TEXT[],
    "para" TEXT NOT NULL,
    "noPara" TEXT NOT NULL,
    "alerta" TEXT,
    "imagenUrl" TEXT,
    "fuente" TEXT NOT NULL,
    "fechaDato" TEXT NOT NULL,
    "confianza" "Confianza" NOT NULL,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "nombre" TEXT,
    "origen" TEXT NOT NULL,
    "origenes" TEXT[],
    "etiquetas" TEXT[],
    "consienteMarketing" BOOLEAN NOT NULL DEFAULT false,
    "consentimientoTexto" TEXT,
    "consentimientoFecha" TIMESTAMP(3),
    "bajaFecha" TIMESTAMP(3),
    "bajaMotivo" TEXT,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carrito" (
    "id" TEXT NOT NULL,
    "correo" TEXT,
    "consiente" BOOLEAN NOT NULL DEFAULT false,
    "estado" "EstadoCarrito" NOT NULL DEFAULT 'ABIERTO',
    "valor" INTEGER NOT NULL DEFAULT 0,
    "diaSecuencia" INTEGER NOT NULL DEFAULT 0,
    "proximoCorreo" TIMESTAMP(3),
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarritoItem" (
    "id" TEXT NOT NULL,
    "carritoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "CarritoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "estado" "EstadoPedido" NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "descuento" INTEGER NOT NULL DEFAULT 0,
    "envio" INTEGER,
    "total" INTEGER NOT NULL,
    "neto" INTEGER NOT NULL,
    "iva" INTEGER NOT NULL,
    "cuponCodigo" TEXT,
    "contactoNombre" TEXT NOT NULL,
    "contactoCorreo" TEXT NOT NULL,
    "contactoTelefono" TEXT,
    "despachoModo" "ModoDespacho" NOT NULL,
    "despachoRegion" TEXT,
    "despachoComuna" TEXT,
    "despachoDireccion" TEXT,
    "despachoNotas" TEXT,
    "documentoTipo" "TipoDocumento" NOT NULL,
    "rut" TEXT,
    "razonSocial" TEXT,
    "giro" TEXT,
    "direccionFactura" TEXT,
    "stockPorConfirmar" BOOLEAN NOT NULL DEFAULT false,
    "envioPorConfirmar" BOOLEAN NOT NULL DEFAULT false,
    "pagoMetodo" TEXT,
    "pagoEstado" TEXT,
    "pagoReferencia" TEXT,
    "pagoMonto" INTEGER,
    "pagoFecha" TIMESTAMP(3),
    "pagoBruto" JSONB,
    "idempotencia" TEXT,
    "carritoId" TEXT,
    "caducaEn" TIMESTAMP(3),
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoItem" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "condicion" "Condicion",

    CONSTRAINT "PedidoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoEvento" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "estado" "EstadoPedido" NOT NULL,
    "nota" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedidoEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cupon" (
    "codigo" TEXT NOT NULL,
    "tipo" "TipoCupon" NOT NULL,
    "valor" INTEGER NOT NULL,
    "minimo" INTEGER NOT NULL DEFAULT 0,
    "caduca" TIMESTAMP(3),
    "usos" INTEGER,
    "usados" INTEGER NOT NULL DEFAULT 0,
    "unoPorCorreo" BOOLEAN NOT NULL DEFAULT true,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cupon_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "CuponUso" (
    "id" TEXT NOT NULL,
    "cuponCodigo" TEXT NOT NULL,
    "correoHash" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuponUso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cotizacion" (
    "id" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "nombre" TEXT,
    "empresa" TEXT,
    "telefono" TEXT,
    "equipos" INTEGER NOT NULL,
    "perfil" TEXT NOT NULL,
    "presupuesto" INTEGER NOT NULL,
    "accesorios" BOOLEAN NOT NULL,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorreoEncolado" (
    "id" TEXT NOT NULL,
    "para" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "bajaUrl" TEXT,
    "transaccional" BOOLEAN NOT NULL DEFAULT false,
    "clave" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "estado" "EstadoCorreo" NOT NULL DEFAULT 'PENDIENTE',
    "programadoPara" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorreoEncolado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorreoDiario" (
    "id" TEXT NOT NULL,
    "correoHash" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CorreoDiario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contador" (
    "clave" TEXT NOT NULL,
    "valor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Contador_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "Producto_slug_key" ON "Producto"("slug");

-- CreateIndex
CREATE INDEX "Producto_categoria_idx" ON "Producto"("categoria");

-- CreateIndex
CREATE INDEX "Producto_marca_idx" ON "Producto"("marca");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_correo_key" ON "Lead"("correo");

-- CreateIndex
CREATE INDEX "Carrito_estado_proximoCorreo_idx" ON "Carrito"("estado", "proximoCorreo");

-- CreateIndex
CREATE UNIQUE INDEX "CarritoItem_carritoId_productoId_key" ON "CarritoItem"("carritoId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_numero_key" ON "Pedido"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_idempotencia_key" ON "Pedido"("idempotencia");

-- CreateIndex
CREATE INDEX "Pedido_estado_caducaEn_idx" ON "Pedido"("estado", "caducaEn");

-- CreateIndex
CREATE INDEX "Pedido_contactoCorreo_idx" ON "Pedido"("contactoCorreo");

-- CreateIndex
CREATE UNIQUE INDEX "CuponUso_cuponCodigo_correoHash_key" ON "CuponUso"("cuponCodigo", "correoHash");

-- CreateIndex
CREATE UNIQUE INDEX "CorreoEncolado_clave_key" ON "CorreoEncolado"("clave");

-- CreateIndex
CREATE INDEX "CorreoEncolado_estado_programadoPara_idx" ON "CorreoEncolado"("estado", "programadoPara");

-- CreateIndex
CREATE UNIQUE INDEX "CorreoDiario_correoHash_dia_key" ON "CorreoDiario"("correoHash", "dia");

-- AddForeignKey
ALTER TABLE "CarritoItem" ADD CONSTRAINT "CarritoItem_carritoId_fkey" FOREIGN KEY ("carritoId") REFERENCES "Carrito"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarritoItem" ADD CONSTRAINT "CarritoItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_carritoId_fkey" FOREIGN KEY ("carritoId") REFERENCES "Carrito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoEvento" ADD CONSTRAINT "PedidoEvento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuponUso" ADD CONSTRAINT "CuponUso_cuponCodigo_fkey" FOREIGN KEY ("cuponCodigo") REFERENCES "Cupon"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;
