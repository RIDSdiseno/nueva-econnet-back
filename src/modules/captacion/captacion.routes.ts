import { Router } from "express";
import { limitePorIp } from "../../middlewares/limites.js";
import { validarConsulta, validarCuerpo } from "../../middlewares/validar.js";
import { baja, suscribir } from "./captacion.controller.js";
import { bajaSchema, suscribirSchema } from "./captacion.schemas.js";

export const rutasCaptacion = Router();

rutasCaptacion.post("/suscribir", limitePorIp(), validarCuerpo(suscribirSchema), suscribir);
rutasCaptacion.get("/baja", validarConsulta(bajaSchema), baja);
