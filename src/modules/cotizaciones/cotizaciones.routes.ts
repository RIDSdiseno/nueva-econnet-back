import { Router } from "express";
import { limitePorIp } from "../../middlewares/limites.js";
import { validarConsulta, validarCuerpo } from "../../middlewares/validar.js";
import { aceptarCotizacion, crearCotizacionControlador, verCotizacion } from "./cotizaciones.controller.js";
import { aceptarSchema, cotizarSchema, verCotizacionSchema } from "./cotizaciones.schemas.js";

export const rutasCotizaciones = Router();

rutasCotizaciones.post("/cotizar", limitePorIp(), validarCuerpo(cotizarSchema), crearCotizacionControlador);
rutasCotizaciones.get("/cotizacion", limitePorIp(60), validarConsulta(verCotizacionSchema), verCotizacion);
rutasCotizaciones.get("/cotizacion/aceptar", limitePorIp(60), validarConsulta(aceptarSchema), aceptarCotizacion);
