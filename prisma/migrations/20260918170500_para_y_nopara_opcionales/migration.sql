-- «Para quién es» y «para quién no» son texto editorial: al dar de alta un
-- equipo todavía no están escritos. Pasan a poder faltar, y el panel los
-- cuenta como hueco en vez de obligar a inventarlos en el formulario.

ALTER TABLE "Producto" ALTER COLUMN "para" DROP NOT NULL;
ALTER TABLE "Producto" ALTER COLUMN "noPara" DROP NOT NULL;
