import { describe, expect, it } from "vitest";
import { pagoRecibido } from "../../src/services/plantillas-pedido.js";
import { comprobarPieza } from "../../src/services/correo.js";
import { correoDeSecuencia, DIAS_SECUENCIA } from "../../src/services/plantillas.js";
import { enlacesDe } from "../../src/services/leads.service.js";

const enlaces = {
  sitio: "https://econnet.cl",
  baja: "https://econnet.cl/api/baja?t=1",
  parar: "https://econnet.cl/api/baja?t=2",
  carrito: "https://econnet.cl/carrito",
  guia: "https://econnet.cl/guia-de-compra",
  whatsapp: ""
};

describe("correos", () => {
  it("un correo comercial sin enlace de baja no sale", () => {
    expect(() =>
      comprobarPieza({ para: "a@b.cl", asunto: "x", texto: "sin nada", html: "x" })
    ).toThrow(/baja/);
  });

  it("un transaccional no lleva baja, pero identifica quién escribe", () => {
    expect(() =>
      comprobarPieza({ para: "a@b.cl", asunto: "x", texto: "Tu pedido. Econnet.", html: "x", transaccional: true })
    ).not.toThrow();

    expect(() =>
      comprobarPieza({ para: "a@b.cl", asunto: "x", texto: "sin remitente", html: "x", transaccional: true })
    ).toThrow(/remitente/);
  });

  it("los siete correos de la secuencia existen y son distintos", () => {
    const asuntos = new Set<string>();
    for (let dia = 1; dia <= DIAS_SECUENCIA; dia++) {
      const pieza = correoDeSecuencia({ dia, prod: null, alternativas: [], enlaces });
      expect(pieza).not.toBeNull();
      expect(pieza?.texto).toMatch(/baja/);
      asuntos.add(pieza?.asunto ?? "");
    }
    expect(asuntos.size).toBe(DIAS_SECUENCIA);
  });

  it("después del séptimo no hay más", () => {
    expect(correoDeSecuencia({ dia: 8, prod: null, alternativas: [], enlaces })).toBeNull();
  });
});

describe("los enlaces de los correos", () => {
  it("no apuntan a rutas de la tienda vieja", () => {
    const enlaces = enlacesDe("quien@econnet.cl", { carritoId: "c1" });

    /* `/tienda/carrito` caía en la ficha de un producto inexistente, y era el
       enlace del correo de carrito abandonado: el que trae la venta de vuelta. */
    expect(enlaces.carrito).toContain("/carrito?c=c1");
    expect(enlaces.carrito).not.toContain("/tienda/carrito");
    expect(enlaces.guia).toContain("/guia-de-compra");
  });

  it("el correo de pago recibido lleva al seguimiento que existe", () => {
    const pieza = pagoRecibido({
      numero: "ECN-2026-00001",
      estado: "PAGADO",
      subtotal: 100000, descuento: 0, envio: 0, total: 100000, neto: 84034, iva: 15966,
      documentoTipo: "BOLETA", despachoModo: "RETIRO",
      contactoNombre: "Quien", contactoCorreo: "quien@econnet.cl",
      stockPorConfirmar: false, envioPorConfirmar: false,
      items: [{ nombre: "Un equipo", precio: 100000, cantidad: 1 }]
    });

    expect(pieza.html).toContain("/seguimiento?n=ECN-2026-00001");
    expect(pieza.html).not.toContain("/tienda/seguimiento");
  });
});
