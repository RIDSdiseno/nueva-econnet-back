/**
 * El panel de inventario. Lo que se comprueba aquí no es que la pantalla sea
 * bonita: es que nadie escriba el catálogo sin sesión, que un hueco siga
 * siendo un hueco después de pasar por el formulario, y que lo que se toca en
 * el panel salga de verdad por la API pública.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { CLAVE_PANEL } from "../preparar.js";
import { compraBase, crearProducto, productoVendible } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

/** Entra y devuelve la cookie de sesión, lista para pegarla en la siguiente. */
async function entrar(): Promise<string> {
  const r = await request(app).post("/api/panel/entrar").send({ clave: CLAVE_PANEL });
  expect(r.status).toBe(200);
  const galleta = r.headers["set-cookie"]?.[0];
  expect(galleta).toBeTruthy();
  return String(galleta).split(";")[0] ?? "";
}

const conSesion = (peticion: request.Test, cookie: string) =>
  peticion.set("Cookie", cookie).set("X-Panel", "1");

const ALTA_MINIMA = {
  marca: "Lenovo",
  nombre: "ThinkPad E14 Gen 6",
  categoria: "Notebook",
  fuente: "Proveedor"
};

describe("la puerta del panel", () => {
  it("sin sesión no se ve el inventario", async () => {
    const r = await request(app).get("/api/panel/inventario");
    expect(r.status).toBe(401);
    expect(r.body.error.codigo).toBe("no_autorizado");
  });

  it("sin sesión no se crea un producto", async () => {
    const r = await request(app).post("/api/panel/productos").send(ALTA_MINIMA);
    expect(r.status).toBe(401);
  });

  it("una clave equivocada no abre nada y no dice por qué", async () => {
    const r = await request(app).post("/api/panel/entrar").send({ clave: "la-que-no-es" });
    expect(r.status).toBe(401);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain("scrypt");
  });

  it("la cookie de sesión es HttpOnly, SameSite=Strict y caduca sola", async () => {
    const r = await request(app).post("/api/panel/entrar").send({ clave: CLAVE_PANEL });
    const galleta = String(r.headers["set-cookie"]?.[0]);
    expect(galleta).toContain("HttpOnly");
    expect(galleta).toContain("SameSite=Strict");
    expect(galleta).toMatch(/Max-Age=\d+/);
  });

  it("con la cookie pero sin la cabecera X-Panel, escribir no pasa", async () => {
    const cookie = await entrar();
    const r = await request(app).post("/api/panel/productos").set("Cookie", cookie).send(ALTA_MINIMA);
    expect(r.status).toBe(401);
  });

  it("salir invalida la cookie en el navegador", async () => {
    const r = await request(app).post("/api/panel/salir");
    expect(String(r.headers["set-cookie"]?.[0])).toContain("Max-Age=0");
  });

  it("leer el inventario sí funciona con sesión", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    expect(r.status).toBe(200);
    expect(r.body.resumen).toBeTruthy();
  });
});

describe("dar de alta un equipo", () => {
  it("con lo mínimo se crea, y lo que no se dijo queda en null, no en cero", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/productos"), cookie).send(ALTA_MINIMA);

    expect(r.status).toBe(201);
    const p = r.body.producto;
    expect(p.id).toBe("lenovo-thinkpad-e14-gen-6");
    expect(p.slug).toBe("lenovo-thinkpad-e14-gen-6");
    expect(p.precioVenta).toBeNull();
    expect(p.condicion).toBeNull();
    expect(p.stockUnidades).toBeNull();
    expect(p.stockEstado).toBe("DESCONOCIDO");
    expect(p.imagenUrl).toBeNull();
    expect(p.sku).toBeNull();
  });

  it("y el panel dice exactamente qué le falta para poder venderse", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/productos"), cookie).send(ALTA_MINIMA);

    expect(r.body.producto.seVende).toBe(false);
    expect(r.body.producto.publicable.ok).toBe(false);
    expect(r.body.producto.publicable.faltas).toContain("sin precio propio");
    expect(r.body.producto.publicable.faltas).toContain("sin condición declarada");
    expect(r.body.producto.publicable.faltas).toContain("sin imagen");
  });

  /**
   * El formulario manda `null` explícito en lo que se dejó en blanco, que no
   * es lo mismo que no mandar el campo. Distinguirlo es la diferencia entre
   * «no consta» y «cuesta cero pesos»: con `null` convertido en 0 el equipo
   * salía a la venta gratis. Pasó de verdad.
   */
  it("un precio en blanco se guarda como «no consta», nunca como cero", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/productos"), cookie).send({
      ...ALTA_MINIMA,
      precioVenta: null,
      precioLista: null,
      precioFalabella: null,
      precioLider: null,
      stockUnidades: null
    });

    expect(r.status).toBe(201);
    expect(r.body.producto.precioVenta).toBeNull();
    expect(r.body.producto.precioVenta).not.toBe(0);
    expect(r.body.producto.precioLista).toBeNull();
    expect(r.body.producto.stockUnidades).toBeNull();
    expect(r.body.producto.seVende).toBe(false);

    /* Y lo importante: en la tienda no aparece un equipo a cero pesos. */
    const publico = await request(app).get("/api/catalogo");
    const fila = publico.body.productos.find((p: { id: string }) => p.id === "lenovo-thinkpad-e14-gen-6");
    expect(fila.precio.venta).toBeNull();
    expect(fila.seVende).toBe(false);
  });

  it("un precio de cero no pone el botón de comprar: cero no es un precio", async () => {
    await crearProducto({ id: "p0", slug: "p0", marca: "HP", nombre: "Regalado", precioVenta: 0, stockUnidades: 3 });

    const ficha = await request(app).get("/api/catalogo/p0");
    expect(ficha.body.producto.seVende).toBe(false);
    expect(ficha.body.producto.referencia.propio).toBe(false);

    const totales = await request(app).post("/api/totales").send({ items: [{ productoId: "p0", cantidad: 1 }] });
    expect(totales.body.lineas).toHaveLength(0);
  });

  it("editar poniendo el precio en blanco lo devuelve a «no consta», no a cero", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();

    await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ precioVenta: null });

    const ficha = await request(app).get("/api/catalogo/p1");
    expect(ficha.body.producto.precio.venta).toBeNull();
    expect(ficha.body.producto.seVende).toBe(false);
  });

  it("dejar las unidades en blanco es «sin contar», no «cero unidades»", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();

    const r = await conSesion(request(app).post("/api/panel/productos/p1/stock"), cookie).send({ unidades: null });
    expect(r.body.producto.stockUnidades).toBeNull();
    expect(r.body.producto.stockEstado).toBe("DESCONOCIDO");
    expect(r.body.producto.stockEstado).not.toBe("SIN_EXISTENCIAS");
  });

  /**
   * El segundo intento de esto también se quedó corto, y lo encontró una
   * auditoría externa. `z.null()` primero en el union solo atrapa el `null`
   * literal; `""`, `" "`, `[]` y `false` seguían cayendo en
   * `z.coerce.number()`, que los convierte en **cero** a los cuatro. Un coste
   * de cero pesos da un margen del 100%: el número con el que se decide un
   * presupuesto de publicidad.
   */
  describe("vacío nunca es cero, venga como venga", () => {
    for (const [nombre, valor] of [["cadena vacía", ""], ["espacios", "   "], ["nulo", null]] as const) {
      it(`«${nombre}» deja el coste en «no consta»`, async () => {
        await productoVendible("p1", 5);
        const cookie = await entrar();

        const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ costoNeto: valor });

        expect(r.status).toBe(200);
        expect(r.body.producto.costoNeto).toBeNull();
        expect(r.body.producto.costoNeto).not.toBe(0);
        /* Y sin coste no hay margen: ni 100%, ni 0%. */
        expect(r.body.producto.margen.porcentaje).toBeNull();
      });
    }

    for (const [nombre, valor] of [["lista", []], ["booleano", false], ["objeto", {}], ["texto", "mil pesos"]] as const) {
      it(`«${nombre}» se rechaza en vez de convertirse en cero`, async () => {
        await productoVendible("p1", 5);
        const cookie = await entrar();

        const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ costoNeto: valor });
        expect(r.status).toBe(400);

        /* Y el producto se queda como estaba. */
        const ficha = await request(app).get("/api/catalogo/p1");
        expect(ficha.status).toBe(200);
      });
    }

    it("lo mismo en el alta: un precio vacío no crea un equipo de cero pesos", async () => {
      const cookie = await entrar();
      const r = await conSesion(request(app).post("/api/panel/productos"), cookie)
        .send({ ...ALTA_MINIMA, precioVenta: "", stockUnidades: "" });

      expect(r.status).toBe(201);
      expect(r.body.producto.precioVenta).toBeNull();
      expect(r.body.producto.stockUnidades).toBeNull();
      expect(r.body.producto.stockEstado).toBe("DESCONOCIDO");
      expect(r.body.producto.seVende).toBe(false);
    });

    it("y en el ajuste de stock, que tenía su propio esquema", async () => {
      await productoVendible("p1", 5);
      const cookie = await entrar();

      const vacio = await conSesion(request(app).post("/api/panel/productos/p1/stock"), cookie).send({ unidades: "" });
      expect(vacio.body.producto.stockUnidades).toBeNull();
      expect(vacio.body.producto.stockEstado).toBe("DESCONOCIDO");

      const lista = await conSesion(request(app).post("/api/panel/productos/p1/stock"), cookie).send({ unidades: [] });
      expect(lista.status).toBe(400);
    });

    it("un número que sí viene como texto se acepta: hay clientes que mandan cadenas", async () => {
      await productoVendible("p1", 5);
      const cookie = await entrar();

      const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ costoNeto: "790000" });
      expect(r.body.producto.costoNeto).toBe(790_000);
    });

    it("pero un cero escrito a propósito sigue siendo un cero", async () => {
      await productoVendible("p1", 5);
      const cookie = await entrar();

      const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ costoNeto: 0 });
      expect(r.body.producto.costoNeto).toBe(0);
    });
  });

  it("un campo que no existe se rechaza: no entra nada por la puerta de atrás", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/productos"), cookie)
      .send({ ...ALTA_MINIMA, reservadas: 999 });
    expect(r.status).toBe(400);
  });

  it("dos veces la misma dirección no se permite", async () => {
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/productos"), cookie).send(ALTA_MINIMA);
    const r = await conSesion(request(app).post("/api/panel/productos"), cookie).send(ALTA_MINIMA);
    expect(r.status).toBe(409);
  });

  it("un stock negativo no se guarda: «stock = −1» no es un dato", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/productos"), cookie)
      .send({ ...ALTA_MINIMA, stockUnidades: -1 });
    expect(r.status).toBe(400);
  });

  it("lo que se da de alta con precio y stock sale ya en el catálogo público", async () => {
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/productos"), cookie).send({
      ...ALTA_MINIMA,
      precioVenta: 749990,
      condicion: "NUEVO",
      stockUnidades: 4
    });

    const publico = await request(app).get("/api/catalogo");
    const encontrado = publico.body.productos.find((p: { id: string }) => p.id === "lenovo-thinkpad-e14-gen-6");
    expect(encontrado).toBeTruthy();
    expect(encontrado.precio.venta).toBe(749990);
    expect(encontrado.seVende).toBe(true);

    const ficha = await request(app).get("/api/catalogo/lenovo-thinkpad-e14-gen-6");
    expect(ficha.status).toBe(200);
  });
});

describe("editar un equipo", () => {
  it("cambiar el precio se ve en la ficha pública al momento", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();

    const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie)
      .send({ precioVenta: 555000, motivo: "ajuste de temporada" });
    expect(r.status).toBe(200);

    const ficha = await request(app).get("/api/catalogo/p1");
    expect(ficha.body.producto.precio.venta).toBe(555000);
  });

  it("queda escrito qué decía antes, qué dice ahora y por qué", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();
    const antes = (await request(app).get("/api/catalogo/p1")).body.producto.precio.venta;

    await conSesion(request(app).patch("/api/panel/productos/p1"), cookie)
      .send({ precioVenta: 555000, motivo: "ajuste de temporada" });

    const r = await conSesion(request(app).get("/api/panel/productos/p1/cambios"), cookie);
    const precio = r.body.cambios.find((c: { campo: string }) => c.campo === "precioVenta");
    expect(precio.antes).toBe(String(antes));
    expect(precio.despues).toBe("555000");
    expect(precio.motivo).toBe("ajuste de temporada");
  });

  /**
   * El formulario manda la ficha **entera**, no solo lo que se tocó. Así que
   * un campo que el catálogo ya traía en otro formato tumbaba el guardado
   * completo: la fecha del dato viene a la chilena (18-09-2026) y el esquema
   * solo aceptaba ISO. Editar cualquier equipo de la semilla daba 400.
   */
  it("se puede guardar un equipo cuya fecha viene a la chilena", async () => {
    await crearProducto({ id: "p1", slug: "p1", marca: "ASUS", nombre: "ExpertBook", fechaDato: "18-09-2026" });
    const cookie = await entrar();

    const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie)
      .send({ costoNeto: 790_000, fechaDato: "18-09-2026", fuente: "Proveedor", confianza: "ALTA" });

    expect(r.status).toBe(200);
    expect(r.body.producto.costoNeto).toBe(790_000);
    /* Y se queda como estaba: no la reformatea nadie por su cuenta. */
    expect(r.body.producto.fechaDato).toBe("18-09-2026");
  });

  it("y también en ISO, que es lo que sugiere el formulario", async () => {
    await crearProducto({ id: "p1", slug: "p1", marca: "ASUS", nombre: "ExpertBook", fechaDato: "18-09-2026" });
    const cookie = await entrar();

    const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ fechaDato: "2026-09-21" });
    expect(r.status).toBe(200);
    expect(r.body.producto.fechaDato).toBe("2026-09-21");
  });

  it("pero una fecha que no es una fecha sigue sin entrar", async () => {
    await crearProducto({ id: "p1", slug: "p1", marca: "ASUS", nombre: "ExpertBook" });
    const cookie = await entrar();

    const r = await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ fechaDato: "el martes" });
    expect(r.status).toBe(400);
  });

  it("vaciar un campo con null lo deja en «no consta», no en cadena vacía", async () => {
    await crearProducto({ id: "p1", slug: "p1", marca: "HP", nombre: "X", garantia: "12 meses" });
    const cookie = await entrar();

    await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ garantia: null });

    const ficha = await request(app).get("/api/catalogo/p1");
    expect(ficha.body.producto.garantia).toBeNull();
  });

  it("mandar lo mismo no ensucia el historial con un cambio que no lo fue", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();
    const actual = (await request(app).get("/api/catalogo/p1")).body.producto.precio.venta;

    await conSesion(request(app).patch("/api/panel/productos/p1"), cookie).send({ precioVenta: actual });

    const r = await conSesion(request(app).get("/api/panel/productos/p1/cambios"), cookie);
    expect(r.body.cambios.filter((c: { campo: string }) => c.campo === "precioVenta")).toHaveLength(0);
  });

  it("cambiar las unidades deja el estado de stock coherente solo", async () => {
    await productoVendible("p1", 10);
    const cookie = await entrar();

    const r = await conSesion(request(app).post("/api/panel/productos/p1/stock"), cookie).send({ unidades: 0 });
    expect(r.body.producto.stockEstado).toBe("SIN_EXISTENCIAS");

    const dos = await conSesion(request(app).post("/api/panel/productos/p1/stock"), cookie).send({ unidades: 2 });
    expect(dos.body.producto.stockEstado).toBe("LIMITADO");
  });

  it("no se puede dejar el stock por debajo de lo ya reservado", async () => {
    await productoVendible("p1", 10);
    /* Un pedido vivo reserva tres unidades. */
    await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, idempotencia: "panel-reserva-3", items: [{ productoId: "p1", cantidad: 3 }] });

    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/productos/p1/stock"), cookie).send({ unidades: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error.mensaje).toContain("reservadas");
  });
});

describe("retirar un equipo sin borrarlo", () => {
  it("archivado desaparece del catálogo público pero sigue en el panel", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();

    const r = await conSesion(request(app).post("/api/panel/productos/p1/archivo"), cookie)
      .send({ archivar: true, motivo: "descatalogado por el proveedor" });
    expect(r.status).toBe(200);

    const publico = await request(app).get("/api/catalogo");
    expect(publico.body.productos.find((p: { id: string }) => p.id === "p1")).toBeUndefined();
    expect((await request(app).get("/api/catalogo/p1")).status).toBe(404);

    const panel = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    const fila = panel.body.productos.find((p: { id: string }) => p.id === "p1");
    expect(fila).toBeTruthy();
    expect(fila.archivado).toBeTruthy();
  });

  it("y se puede devolver a la venta", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/productos/p1/archivo"), cookie).send({ archivar: true });
    await conSesion(request(app).post("/api/panel/productos/p1/archivo"), cookie).send({ archivar: false });

    expect((await request(app).get("/api/catalogo/p1")).status).toBe(200);
  });

  it("un equipo archivado ya no se puede comprar, y el carrito lo dice", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/productos/p1/archivo"), cookie).send({ archivar: true });

    const r = await request(app).post("/api/totales").send({ items: [{ productoId: "p1", cantidad: 1 }] });
    expect(r.body.rechazadas[0].motivo).toBe("ya no está a la venta");
  });
});

describe("el resumen del inventario", () => {
  it("cuenta los huecos por tipo, que es la lista de tareas", async () => {
    await productoVendible("p1", 10);
    await productoVendible("p2", 10);
    const cookie = await entrar();

    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    const imagen = r.body.resumen.huecos.find((h: { falta: string }) => h.falta === "sin imagen");
    expect(imagen.cuantos).toBe(2);
  });

  it("el valor del inventario solo suma lo que tiene precio y unidades", async () => {
    await crearProducto({ id: "a", slug: "a", marca: "HP", nombre: "A", precioVenta: 100000, stockUnidades: 2 });
    /* Este tiene precio pero no unidades: no puede sumar sin inventarlas. */
    await crearProducto({ id: "b", slug: "b", marca: "HP", nombre: "B", precioVenta: 900000 });
    const cookie = await entrar();

    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    expect(r.body.resumen.valorInventario).toBe(200000);
  });

  it("sin nada que sumar el valor es null, no cero", async () => {
    await crearProducto({ id: "b", slug: "b", marca: "HP", nombre: "B", precioVenta: 900000 });
    const cookie = await entrar();

    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    expect(r.body.resumen.valorInventario).toBeNull();
  });

  it("las unidades disponibles descuentan lo reservado", async () => {
    await productoVendible("p1", 10);
    await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, idempotencia: "panel-reserva-4", items: [{ productoId: "p1", cantidad: 4 }] });

    const cookie = await entrar();
    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    const fila = r.body.productos.find((p: { id: string }) => p.id === "p1");
    expect(fila.stockUnidades).toBe(10);
    expect(fila.reservadas).toBe(4);
    expect(fila.disponibles).toBe(6);
  });
});
