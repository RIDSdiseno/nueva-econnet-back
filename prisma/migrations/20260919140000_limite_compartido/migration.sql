-- CreateTable
CREATE TABLE "LimitePeticion" (
    "clave" TEXT NOT NULL,
    "golpes" INTEGER NOT NULL DEFAULT 0,
    "expira" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LimitePeticion_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "LimitePeticion_expira_idx" ON "LimitePeticion"("expira");

