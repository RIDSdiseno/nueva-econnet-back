/**
 * La pasarela. Tres adaptadores detrás de una sola interfaz:
 *
 *   simulado      no cobra nada. El de por defecto y el de las pruebas.
 *   webpay        Transbank Webpay Plus (REST)
 *   mercadopago   Checkout Pro
 *
 * ⚠ Escrito contra la documentación, sin probar contra la red: el primer pago
 * de verdad se hace en el ambiente de integración de cada pasarela. Lo que sí
 * está probado es todo lo que rodea al cobro: monto, idempotencia y descuadre.
 *
 * Reglas para cualquier pasarela:
 *  · El monto lo pone el servidor, nunca el navegador.
 *  · Confirmar es preguntarle a la pasarela, no creerse la vuelta del
 *    navegador ni el cuerpo de un webhook: los dos se falsifican.
 *  · Todo con tiempo máximo. Si no responde, el pedido NO se marca pagado.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env, esProduccion } from "../config/env.js";
import { logger } from "../config/logger.js";

export interface PedidoAPagar {
  numero: string;
  total: number;
  items: Array<{ nombre: string; precio: number; cantidad: number }>;
}

export type InicioPago =
  | { tipo: "redirect"; url: string; referencia: string | null }
  | { tipo: "post"; url: string; campos: Record<string, string>; referencia: string | null };

export interface ConfirmacionPago {
  ok: boolean;
  numero: string | null;
  monto: number | null;
  referencia: string | null;
  metodo: string;
  motivo?: string;
  bruto?: unknown;
}

export interface DatosConfirmacion {
  token?: string;
  pagoId?: string;
  numero?: string;
}

interface Pasarela {
  iniciar(pedido: PedidoAPagar, urls: { retorno: string; aviso: string }): Promise<InicioPago>;
  confirmar(datos: DatosConfirmacion): Promise<ConfirmacionPago>;
}

async function pedir(url: string, opciones: RequestInit): Promise<Record<string, unknown>> {
  const respuesta = await fetch(url, { ...opciones, signal: AbortSignal.timeout(env.PAGO_TIMEOUT_MS) });
  const texto = await respuesta.text();
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    cuerpo = { crudo: texto.slice(0, 300) };
  }
  if (!respuesta.ok) {
    logger.error({ estado: respuesta.status, url: url.split("?")[0] }, "la pasarela respondió mal");
    throw new Error(`pasarela ${respuesta.status}`);
  }
  return cuerpo;
}

/* -------------------------------------------------------------- simulado */
export const simulado: Pasarela = {
  async iniciar(pedido, urls) {
    return {
      tipo: "redirect",
      url: `${urls.retorno}?metodo=simulado&numero=${encodeURIComponent(pedido.numero)}`,
      referencia: `sim-${pedido.numero}`
    };
  },
  async confirmar(datos) {
    return {
      ok: true,
      numero: datos.numero ?? null,
      monto: null, /* el monto lo pone el pedido, no la pasarela simulada */
      referencia: `sim-${datos.numero ?? ""}`,
      metodo: "simulado",
      bruto: { simulado: true }
    };
  }
};

/* ---------------------------------------------------------------- webpay */
const RUTA_WEBPAY = "/rswebpaytransaction/api/webpay/v1.2/transactions";

const cabecerasWebpay = (): Record<string, string> => ({
  "Tbk-Api-Key-Id": env.WEBPAY_CODIGO_COMERCIO,
  "Tbk-Api-Key-Secret": env.WEBPAY_API_KEY,
  "Content-Type": "application/json"
});

export const webpay: Pasarela = {
  async iniciar(pedido, urls) {
    const cuerpo = await pedir(env.WEBPAY_BASE + RUTA_WEBPAY, {
      method: "POST",
      headers: cabecerasWebpay(),
      body: JSON.stringify({
        buy_order: pedido.numero.slice(0, 26),
        session_id: pedido.numero,
        amount: Math.round(pedido.total),
        return_url: urls.retorno
      })
    });
    /* Webpay exige llegar por POST con el campo token_ws. */
    return {
      tipo: "post",
      url: String(cuerpo.url),
      campos: { token_ws: String(cuerpo.token) },
      referencia: String(cuerpo.token)
    };
  },

  async confirmar(datos) {
    const cuerpo = await pedir(`${env.WEBPAY_BASE}${RUTA_WEBPAY}/${encodeURIComponent(datos.token ?? "")}`, {
      method: "PUT",
      headers: cabecerasWebpay()
    });
    const aprobado = cuerpo.response_code === 0 && cuerpo.status === "AUTHORIZED";
    return {
      ok: aprobado,
      numero: String(cuerpo.session_id ?? cuerpo.buy_order ?? ""),
      monto: Number(cuerpo.amount),
      referencia: String(cuerpo.authorization_code ?? datos.token ?? ""),
      metodo: "webpay",
      motivo: aprobado ? undefined : `rechazada (response_code ${String(cuerpo.response_code)}, status ${String(cuerpo.status)})`,
      bruto: {
        status: cuerpo.status,
        response_code: cuerpo.response_code,
        payment_type_code: cuerpo.payment_type_code,
        installments_number: cuerpo.installments_number
      }
    };
  }
};

/* ----------------------------------------------------------- mercadopago */
export const mercadopago: Pasarela = {
  async iniciar(pedido, urls) {
    const cuerpo = await pedir("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: pedido.items.map((i) => ({
          title: i.nombre.slice(0, 250),
          quantity: i.cantidad,
          unit_price: Math.round(i.precio),
          currency_id: "CLP"
        })),
        external_reference: pedido.numero,
        back_urls: { success: urls.retorno, failure: urls.retorno, pending: urls.retorno },
        auto_return: "approved",
        notification_url: urls.aviso
      })
    });
    const url = env.MP_SANDBOX === "1" ? String(cuerpo.sandbox_init_point ?? cuerpo.init_point) : String(cuerpo.init_point);
    return { tipo: "redirect", url, referencia: String(cuerpo.id ?? "") };
  },

  async confirmar(datos) {
    const cuerpo = await pedir(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(datos.pagoId ?? "")}`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` }
    });
    const aprobado = cuerpo.status === "approved";
    return {
      ok: aprobado,
      numero: cuerpo.external_reference ? String(cuerpo.external_reference) : null,
      monto: Number(cuerpo.transaction_amount),
      referencia: String(cuerpo.id ?? ""),
      metodo: "mercadopago",
      motivo: aprobado ? undefined : `estado ${String(cuerpo.status)} (${String(cuerpo.status_detail ?? "sin detalle")})`,
      bruto: { status: cuerpo.status, status_detail: cuerpo.status_detail, payment_method_id: cuerpo.payment_method_id }
    };
  }
};

/**
 * Firma del aviso de Mercado Pago (cabecera x-signature). Capa extra: la
 * comprobación que manda es preguntarle a la API, y eso se hace siempre.
 * Devuelve null cuando no hay secreto configurado: no se opina sin datos.
 */
export function firmaMercadoPagoValida(cabeceras: Record<string, unknown>, consulta: Record<string, unknown>): boolean | null {
  if (!env.MP_WEBHOOK_SECRET) return null;

  const firma = String(cabeceras["x-signature"] ?? "");
  const partes = Object.fromEntries(firma.split(",").map((p) => p.split("=").map((s) => s.trim())));
  if (!partes.ts || !partes.v1) return false;

  const manifiesto = `id:${String(consulta["data.id"] ?? "")};request-id:${String(cabeceras["x-request-id"] ?? "")};ts:${partes.ts};`;
  const esperado = createHmac("sha256", env.MP_WEBHOOK_SECRET).update(manifiesto).digest("hex");
  const a = Buffer.from(partes.v1);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const pasarelas: Record<string, Pasarela> = { simulado, webpay, mercadopago };

export const pasarelaActiva = (): string => env.PASARELA;
export const pasarela = (): Pasarela => {
  /* Segunda barrera, por si alguien cambia la variable con el proceso vivo. */
  if (esProduccion && env.PASARELA === "simulado") {
    throw new Error("En producción hace falta una pasarela real: «simulado» no cobra nada");
  }
  return pasarelas[env.PASARELA] ?? simulado;
};

export const pasarelaConfigurada = (): boolean =>
  env.PASARELA === "simulado" ||
  (env.PASARELA === "webpay" && !!env.WEBPAY_CODIGO_COMERCIO && !!env.WEBPAY_API_KEY) ||
  (env.PASARELA === "mercadopago" && !!env.MP_ACCESS_TOKEN);
