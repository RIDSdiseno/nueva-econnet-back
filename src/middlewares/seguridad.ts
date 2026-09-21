/**
 * Cabeceras y CORS. La API no sirve HTML, así que su CSP es la más cerrada
 * posible: `default-src 'none'`. El CORS es allowlist explícita por ambiente;
 * un `*` aquí significaría que cualquier web puede hacer pedidos con la
 * sesión de quien la visite.
 */
import cors from "cors";
import helmet from "helmet";
import type { RequestHandler } from "express";
import { origenesPermitidos } from "../config/env.js";

export const cabeceras: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "no-referrer" },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }
});

export const corsMiddleware: RequestHandler = cors({
  origin(origen, callback) {
    /* Sin Origin: curl, un webhook o la propia pasarela. Se deja pasar: la
       protección de esos endpoints es su firma, no el CORS. */
    if (!origen) return callback(null, true);
    if (origenesPermitidos.includes(origen)) return callback(null, true);
    return callback(null, false);
  },
  /* `credentials` para que la cookie del panel viaje en desarrollo, donde la
     web (5173) y la API (3000) son orígenes distintos. La allowlist sigue
     siendo explícita: con `origin: "*"` esto sería un agujero, no una opción. */
  credentials: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Request-Id", "X-Panel"],
  maxAge: 600
});
