import { Router } from "express";
import express from "express";
import { limitePorIp } from "../../middlewares/limites.js";
import { avisoDePago, retornoDePago } from "./pagos.controller.js";

export const rutasPagos = Router();

/* Webpay vuelve por POST con el cuerpo como formulario. */
rutasPagos.get("/pago-retorno", limitePorIp(60), retornoDePago);
rutasPagos.post("/pago-retorno", express.urlencoded({ extended: false, limit: "16kb" }), limitePorIp(60), retornoDePago);

/* El webhook no lleva límite por IP: la pasarela llama desde pocas IP para
   muchos pagos, y frenarla sería perder confirmaciones. Su defensa es la
   firma y la consulta a la API. */
rutasPagos.post("/pago-aviso", avisoDePago);
