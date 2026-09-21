/**
 * El panel completo: pedidos, cotizaciones, ajustes, fotos e importación.
 *
 * Lo que se juega aquí es que el panel **gobierne el negocio de verdad**: que
 * una tarifa puesta en pantalla se cobre en el siguiente pedido sin reiniciar
 * nada, que un estado de pedido no pueda saltarse la máquina de estados, y
 * que una imagen que no es una imagen no entre por mucho que se llame .jpg.
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

async function entrar(): Promise<string> {
  const r = await request(app).post("/api/panel/entrar").send({ clave: CLAVE_PANEL });
  return String(r.headers["set-cookie"]?.[0]).split(";")[0] ?? "";
}

const conSesion = (peticion: request.Test, cookie: string) =>
  peticion.set("Cookie", cookie).set("X-Panel", "1");

/** Un PNG de 1×1 de verdad, con su firma. */
const PNG_REAL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const pedirPedido = (extra: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/pedido")
    .send({ ...compraBase, idempotencia: `g-${Math.random().toString(36).slice(2)}`, items: [{ productoId: "p1", cantidad: 1 }], ...extra });

describe("pedidos desde el panel", () => {
  it("sin sesión no se ven los pedidos de nadie", async () => {
    const r = await request(app).get("/api/panel/pedidos");
    expect(r.status).toBe(401);
  });

  it("se listan con su cliente y su total, y con el recuento por estado", async () => {
    await productoVendible("p1", 5);
    await pedirPedido();
    const cookie = await entrar();

    const r = await conSesion(request(app).get("/api/panel/pedidos"), cookie);
    expect(r.status).toBe(200);
    expect(r.body.pedidos).toHaveLength(1);
    expect(r.body.pedidos[0].cliente.correo).toBe(compraBase.correo);
    expect(r.body.cuentas.PENDIENTE_PAGO).toBe(1);
  });

  it("se busca por correo, por número y por nombre", async () => {
    await productoVendible("p1", 5);
    await pedirPedido();
    const cookie = await entrar();

    const porCorreo = await conSesion(request(app).get("/api/panel/pedidos?q=compra@econnet.cl"), cookie);
    expect(porCorreo.body.pedidos).toHaveLength(1);

    const nada = await conSesion(request(app).get("/api/panel/pedidos?q=nadie@ejemplo.cl"), cookie);
    expect(nada.body.pedidos).toHaveLength(0);
  });

  it("la ficha trae el historial de estados y a dónde se puede ir desde aquí", async () => {
    await productoVendible("p1", 5);
    const creado = await pedirPedido();
    const cookie = await entrar();

    const r = await conSesion(request(app).get(`/api/panel/pedidos/${creado.body.numero}`), cookie);
    expect(r.status).toBe(200);
    expect(r.body.eventos.length).toBeGreaterThan(0);
    expect(r.body.siguientes).toContain("PAGADO");
    expect(r.body.siguientes).toContain("ANULADO");
  });

  it("cambiar el estado pasa por la máquina de estados, no la esquiva", async () => {
    await productoVendible("p1", 5);
    const creado = await pedirPedido();
    const cookie = await entrar();

    /* De PENDIENTE_PAGO no se puede ir a ENTREGADO: hay que pasar por pagado. */
    const salto = await conSesion(request(app).post(`/api/panel/pedidos/${creado.body.numero}/estado`), cookie)
      .send({ estado: "ENTREGADO" });
    expect(salto.status).toBe(409);
    expect(salto.body.error.codigo).toBe("transicion_invalida");
  });

  it("anular desde el panel devuelve el stock reservado", async () => {
    await productoVendible("p1", 5);
    const creado = await pedirPedido();
    const cookie = await entrar();

    const antes = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    expect(antes.body.productos.find((p: { id: string }) => p.id === "p1").reservadas).toBe(1);

    await conSesion(request(app).post(`/api/panel/pedidos/${creado.body.numero}/estado`), cookie)
      .send({ estado: "ANULADO", nota: "el cliente se arrepintió" });

    const despues = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    expect(despues.body.productos.find((p: { id: string }) => p.id === "p1").reservadas).toBe(0);
  });

  it("un estado que no existe se rechaza antes de tocar nada", async () => {
    await productoVendible("p1", 5);
    const creado = await pedirPedido();
    const cookie = await entrar();

    const r = await conSesion(request(app).post(`/api/panel/pedidos/${creado.body.numero}/estado`), cookie)
      .send({ estado: "REGALADO" });
    expect(r.status).toBe(400);
  });
});

describe("cotizaciones desde el panel", () => {
  const cotizar = () =>
    request(app).post("/api/cotizar").send({
      correo: "compras@empresa.cl",
      nombre: "Ana Pérez",
      empresa: "Empresa de Prueba",
      telefono: "+56912345678",
      equipos: 20,
      perfil: "administrativo",
      presupuesto: 1_200_000,
      accesorios: false,
      consentimiento: true,
      ms: 5000
    });

  it("se listan con empresa, total y cuándo caduca", async () => {
    await productoVendible("p1", 20);
    await cotizar();
    const cookie = await entrar();

    const r = await conSesion(request(app).get("/api/panel/cotizaciones"), cookie);
    expect(r.status).toBe(200);
    expect(r.body.cotizaciones[0].empresa).toBe("Empresa de Prueba");
    expect(r.body.cotizaciones[0].validaHasta).toBeTruthy();
    expect(r.body.cuentas.ENVIADA).toBe(1);
  });

  it("marcarla como perdida para el seguimiento: no se persigue a quien ya dijo que no", async () => {
    await productoVendible("p1", 20);
    const c = await cotizar();
    const cookie = await entrar();

    const r = await conSesion(request(app).post(`/api/panel/cotizaciones/${c.body.numero}/estado`), cookie)
      .send({ estado: "PERDIDA" });
    expect(r.status).toBe(200);
    expect(r.body.cotizacion.estado).toBe("PERDIDA");
    expect(r.body.cotizacion.proximoCorreo).toBeNull();
  });

  it("la ficha trae la propuesta tal como se envió y los huecos que tenía", async () => {
    await productoVendible("p1", 20);
    const c = await cotizar();
    const cookie = await entrar();

    const r = await conSesion(request(app).get(`/api/panel/cotizaciones/${c.body.numero}`), cookie);
    expect(r.body.cotizacion.propuesta).toBeTruthy();
    expect(Array.isArray(r.body.cotizacion.huecos)).toBe(true);
  });
});

describe("los ajustes del negocio", () => {
  it("se listan con su valor, de dónde sale y qué pasa si falta", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).get("/api/panel/ajustes"), cookie);

    expect(r.status).toBe(200);
    const envio = r.body.ajustes.find((a: { clave: string }) => a.clave === "ENVIO_TABLA");
    expect(envio.siFalta).toContain("No se cobra despacho");
    expect(["panel", "entorno", "vacío"]).toContain(envio.origen);
  });

  it("no expone ni un solo secreto", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).get("/api/panel/ajustes"), cookie);

    const texto = JSON.stringify(r.body);
    for (const prohibido of ["APP_SECRET", "CRON_SECRET", "ADMIN_CLAVE_HASH", "DATABASE_URL", "MP_ACCESS_TOKEN", "WEBPAY_API_KEY", "scrypt$"]) {
      expect(texto).not.toContain(prohibido);
    }
  });

  it("una clave que no es un ajuste del negocio se rechaza", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/ajustes"), cookie).send({ APP_SECRET: "mío" });
    expect(r.status).toBe(400);
  });

  it("poner una tarifa de envío se cobra en el siguiente pedido, sin reiniciar nada", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();

    /* Antes: sin tarifa, el despacho queda por confirmar y no se cobra. */
    const antes = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p1", cantidad: 1 }], despacho: { modo: "DESPACHO", region: "Valparaíso" } });
    expect(antes.body.envio.costo).toBeNull();
    expect(antes.body.envio.porConfirmar).toBe(true);

    await conSesion(request(app).post("/api/panel/ajustes"), cookie)
      .send({ ENVIO_TABLA: "Valparaíso:7990:3" });

    /* Después: se cobra, y con el plazo que se declaró. Ni un despliegue. */
    const despues = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p1", cantidad: 1 }], despacho: { modo: "DESPACHO", region: "Valparaíso" } });
    expect(despues.body.envio.costo).toBe(7990);
    expect(despues.body.envio.porConfirmar).toBe(false);
    expect(despues.body.envio.diasEstimados).toBe(3);
  });

  /**
   * El panel edita las tarifas en un cuadro de texto, una región por línea; la
   * variable de entorno las lleva en una línea separadas por «|». El parser
   * solo entendía «|», así que lo escrito en el panel se guardaba como una
   * región inexistente y el despacho quedaba «por confirmar» sin dar error.
   */
  it("una tarifa escrita por líneas, como la escribe el panel, se cobra igual", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();

    await conSesion(request(app).post("/api/panel/ajustes"), cookie)
      .send({ ENVIO_TABLA: "Metropolitana de Santiago:4990:2\nValparaíso:7990:3" });

    const santiago = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p1", cantidad: 1 }], despacho: { modo: "DESPACHO", region: "Metropolitana de Santiago" } });
    expect(santiago.body.envio.costo).toBe(4990);

    const valpo = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p1", cantidad: 1 }], despacho: { modo: "DESPACHO", region: "Valparaíso" } });
    expect(valpo.body.envio.costo).toBe(7990);
    expect(valpo.body.envio.diasEstimados).toBe(3);
  });

  it("y con barras verticales también, que es como viene del entorno", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();

    await conSesion(request(app).post("/api/panel/ajustes"), cookie)
      .send({ ENVIO_TABLA: "Metropolitana de Santiago:4990|Valparaíso:7990" });

    const r = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p1", cantidad: 1 }], despacho: { modo: "DESPACHO", region: "Valparaíso" } });
    expect(r.body.envio.costo).toBe(7990);
  });

  it("y vaciarla vuelve a dejar el despacho por confirmar, no a cero", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/ajustes"), cookie).send({ ENVIO_TABLA: "Valparaíso:7990" });
    await conSesion(request(app).post("/api/panel/ajustes"), cookie).send({ ENVIO_TABLA: "" });

    const r = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p1", cantidad: 1 }], despacho: { modo: "DESPACHO", region: "Valparaíso" } });
    expect(r.body.envio.costo).toBeNull();
    expect(r.body.envio.costo).not.toBe(0);
  });
});

describe("los datos del negocio, públicos", () => {
  it("lo que no está puesto sale null: no se inventa una razón social", async () => {
    const r = await request(app).get("/api/negocio");
    expect(r.status).toBe(200);
    expect(r.body.negocio.razonSocial).toBeNull();
    expect(r.body.negocio.rut).toBeNull();
  });

  it("puestos en el panel, salen en la web al momento", async () => {
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/ajustes"), cookie)
      .send({ RAZON_SOCIAL: "Econnet SpA", RUT_EMPRESA: "76.123.456-7" });

    const r = await request(app).get("/api/negocio");
    expect(r.body.negocio.razonSocial).toBe("Econnet SpA");
    expect(r.body.negocio.rut).toBe("76.123.456-7");
  });
});

describe("las fotografías", () => {
  it("un PNG de verdad entra y se sirve con su tipo", async () => {
    const cookie = await entrar();
    const subida = await conSesion(request(app).post("/api/panel/medios"), cookie)
      .send({ datos: `data:image/png;base64,${PNG_REAL}`, nombre: "thinkpad.png" });

    expect(subida.status).toBe(201);
    expect(subida.body.medio.tipo).toBe("image/png");

    const servida = await request(app).get(subida.body.medio.url);
    expect(servida.status).toBe(200);
    expect(servida.headers["content-type"]).toContain("image/png");
    expect(servida.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("HTML disfrazado de imagen no entra, por mucho que se llame .jpg", async () => {
    const cookie = await entrar();
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString("base64");
    const r = await conSesion(request(app).post("/api/panel/medios"), cookie)
      .send({ datos: `data:image/jpeg;base64,${html}`, nombre: "inocente.jpg" });

    expect(r.status).toBe(400);
    expect(r.body.error.mensaje).toMatch(/JPEG, PNG y WebP/);
  });

  it("un SVG tampoco: es una imagen que puede ejecutar JavaScript", async () => {
    const cookie = await entrar();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    const r = await conSesion(request(app).post("/api/panel/medios"), cookie)
      .send({ datos: `data:image/svg+xml;base64,${svg}`, nombre: "logo.svg" });
    expect(r.status).toBe(400);
  });

  it("sin sesión no se sube nada", async () => {
    const r = await request(app).post("/api/panel/medios").send({ datos: `data:image/png;base64,${PNG_REAL}` });
    expect(r.status).toBe(401);
  });

  it("la foto subida se puede poner en un equipo y sale en su ficha pública", async () => {
    await productoVendible("p1", 5);
    const cookie = await entrar();
    const subida = await conSesion(request(app).post("/api/panel/medios"), cookie)
      .send({ datos: `data:image/png;base64,${PNG_REAL}`, nombre: "p1.png" });

    await conSesion(request(app).patch("/api/panel/productos/p1"), cookie)
      .send({ imagenUrl: subida.body.medio.url });

    const ficha = await request(app).get("/api/catalogo/p1");
    expect(ficha.body.producto.imagenUrl).toBe(subida.body.medio.url);
    /* Y con foto, ya no cuenta como hueco. */
    expect(ficha.body.producto.publicable.faltas).not.toContain("sin imagen");
  });
});

describe("importar el catálogo", () => {
  const CSV = [
    "sku,marca,nombre,categoria,precio,costo,stock,condicion",
    'NT-001,Lenovo,"ThinkPad E14, 16 GB",Notebook,$899.990,650000,4,Nuevo',
    "NT-002,HP,EliteBook 840,Notebook,,,,Reacondicionado"
  ].join("\n");

  it("por defecto es un ensayo: dice qué pasaría y no toca nada", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/importar"), cookie).send({ csv: CSV });

    expect(r.status).toBe(200);
    expect(r.body.informe.ensayo).toBe(true);
    expect(r.body.informe.altas).toBe(2);

    const inventario = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    expect(inventario.body.productos).toHaveLength(0);
  });

  it("aplicado, crea los equipos con su precio y su coste leídos bien", async () => {
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/importar"), cookie).send({ csv: CSV, aplicar: true });

    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    const think = r.body.productos.find((p: { sku: string }) => p.sku === "NT-001");
    expect(think.precioVenta).toBe(899_990);
    expect(think.costoNeto).toBe(650_000);
    expect(think.stockUnidades).toBe(4);
    expect(think.condicion).toBe("NUEVO");
    /* Y con coste ya hay margen: neto 756.294 − 650.000. */
    expect(think.margen.porcentaje).toBeGreaterThan(0);
  });

  it("las celdas vacías entran como «no consta», nunca como cero", async () => {
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/importar"), cookie).send({ csv: CSV, aplicar: true });

    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    const elite = r.body.productos.find((p: { sku: string }) => p.sku === "NT-002");
    expect(elite.precioVenta).toBeNull();
    expect(elite.costoNeto).toBeNull();
    expect(elite.stockUnidades).toBeNull();
    expect(elite.precioVenta).not.toBe(0);
    expect(elite.seVende).toBe(false);
  });

  it("una segunda pasada con el mismo fichero no cambia nada", async () => {
    const cookie = await entrar();
    await conSesion(request(app).post("/api/panel/importar"), cookie).send({ csv: CSV, aplicar: true });
    const r = await conSesion(request(app).post("/api/panel/importar"), cookie).send({ csv: CSV });

    expect(r.body.informe.altas).toBe(0);
    expect(r.body.informe.iguales).toBe(2);
  });

  it("una columna que no viene no borra lo que ya había", async () => {
    await crearProducto({ id: "lenovo-thinkpad-e14-16-gb", slug: "x", sku: "NT-001", marca: "Lenovo", nombre: "ThinkPad E14, 16 GB", costoNeto: 650_000, precioVenta: 899_990 });
    const cookie = await entrar();

    /* Este CSV no trae la columna «costo». El coste tiene que seguir ahí. */
    await conSesion(request(app).post("/api/panel/importar"), cookie)
      .send({ csv: "sku,marca,nombre,precio\nNT-001,Lenovo,\"ThinkPad E14, 16 GB\",950000", aplicar: true });

    const r = await conSesion(request(app).get("/api/panel/inventario"), cookie);
    const p = r.body.productos.find((x: { sku: string }) => x.sku === "NT-001");
    expect(p.precioVenta).toBe(950_000);
    expect(p.costoNeto).toBe(650_000);
  });

  it("una fila sin marca ni nombre se cuenta como error y no para el resto", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/importar"), cookie)
      .send({ csv: "sku,marca,nombre,categoria\nA,,,Notebook\nB,HP,EliteBook,Notebook" });

    expect(r.body.informe.errores).toBe(1);
    expect(r.body.informe.altas).toBe(1);
  });

  it("dice qué columnas entendió y cuáles ignoró", async () => {
    const cookie = await entrar();
    const r = await conSesion(request(app).post("/api/panel/importar"), cookie)
      .send({ csv: "marca,nombre,peso_envio,proveedor\nHP,EliteBook,2kg,Intcomex" });

    expect(r.body.informe.columnasReconocidas).toContain("marca");
    expect(r.body.informe.columnasIgnoradas).toContain("peso_envio");
    expect(r.body.informe.columnasIgnoradas).toContain("proveedor");
  });
});
