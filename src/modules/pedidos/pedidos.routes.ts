import { Router } from "express";
import { limitePorIp } from "../../middlewares/limites.js";
import { validarConsulta, validarCuerpo } from "../../middlewares/validar.js";
import { calcularTotales, crearPedidoControlador, seguimiento } from "./pedidos.controller.js";
import { crearPedidoSchema, seguimientoSchema, totalesSchema } from "./pedidos.schemas.js";

export const rutasPedidos = Router();

rutasPedidos.post("/totales", limitePorIp(60), validarCuerpo(totalesSchema), calcularTotales);
rutasPedidos.post("/pedido", limitePorIp(), validarCuerpo(crearPedidoSchema), crearPedidoControlador);
rutasPedidos.get("/seguimiento", limitePorIp(), validarConsulta(seguimientoSchema), seguimiento);
