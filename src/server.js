import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import logger from "./utils/logger.js";
import apiRoutes from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');

// --- CONFIGURACIÓN DE CORS ---
const allowedOrigins = [
  'https://masitaprex.com',
  'https://www.masitaprex.com',
  'https://consulta-pe-abf99.firebaseapp.com',
  'https://consulta-pe-abf99.firebasestorage.app',
  'https://masitaprexv2.fly.dev'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn('CORS', 'Origen bloqueado por CORS', { origin });
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json());
app.use(cookieParser());

// --- LISTA DE DOMINIOS PERMITIDOS PARA CSP ---
const cspDomains = [
  "'self'",
  "https://masitaprex.com",
  "https://www.masitaprex.com",
  "https://accounts.google.com",
  "https://identitytoolkit.googleapis.com",
  "https://www.googleapis.com",
  "https://unpkg.com",
  "https://cdn.jsdelivr.net",
  "https://remixicon.com",
  "https://generativelanguage.googleapis.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdnjs.cloudflare.com", 
  "https://cdn.tailwindcss.com",
  "https://firestore.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://firebase.googleapis.com",
  "https://auth.masitaprex.com",
  "https://peliprex-31wrsa.fly.dev",
  "https://cdn.plyr.io",
  "https://images.unsplash.com",
  "https://*.effectivegatecpm.com",
  "https://*.adsterra.com",
  "https://lh3.googleusercontent.com",
  "https://peliprex-pe-v2.fly.dev",
  "https://1.bp.blogspot.com",
  "https://peliprex.fly.dev",
  "https://consulta-pe-abf99.firebaseapp.com",
  "https://consulta-pe-abf99.firebasestorage.app",
  "https://masitaprexv2.fly.dev",
  "https://cdn-icons-png.flaticon.com",
  "https://api.masitaprex.com",
  "https://m.facebook.com",
  "https://youtube.com",
  "https://www.youtube.com",
  "https://wa.me",
  "https://www.gstatic.com",
  "https://www.google.com", // Crítico para reCAPTCHA
  "https://google.com",
  "https://blogger.googleusercontent.com",
  "https://via.placeholder.com",
  "https://image.tmdb.org",
  "https://apis.google.com",
  "https://drive.google.com",
  "https://sdk.mercadopago.com",
  "https://mercadopago.com",
  "https://api.mercadopago.com",
  "https://www.mercadopago.com.pe",
  "https://www.mercadopago.com",
  "https://pago.mercadopago.com.pe",
  "https://http2.mlstatic.com",
  "https://*.mercadopago.com",
  "https://*.mercadolibre.com",
  "https://www.appcreator24.com",
  "https://img.utdstc.com",
  "https://com-masitaorex.uptodown.com",
  "https://stc.utdstc.com",
  "https://apk.e-droid.net",
  "https://apkpure.com",
  "https://placehold.co",
  "https://github.com",
  "https://www.github.com",
  "https://api.github.com",
  "https://www.facebook.com",
  "https://*.firebaseio.com",
  "https://*.googleapis.com"
];

// --- CONFIGURACIÓN DE HELMET CON CSP COMPLETO ---
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...cspDomains],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", ...cspDomains],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", ...cspDomains],
      fontSrc: ["'self'", "data:", ...cspDomains],
      connectSrc: ["'self'", ...cspDomains],
      frameSrc: ["'self'", ...cspDomains],
      mediaSrc: ["'self'", ...cspDomains],
      objectSrc: ["'none'"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'", ...cspDomains],
      prefetchSrc: ["'self'", ...cspDomains],
      formAction: ["'self'", ...cspDomains],
      frameAncestors: ["'self'", ...cspDomains],
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  originAgentCluster: false,
  dnsPrefetchControl: { allow: true },
  frameguard: { action: 'sameorigin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'all' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
}));

// --- RUTAS Y ARCHIVOS ESTÁTICOS ---
app.use("/api", apiRoutes);

const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Clean URLs Mapping
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  
  const cleanPath = req.path.replace(/^\//, '') || 'home';
  const htmlPath = path.join(publicPath, `${cleanPath}.html`);
  
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath);
  }
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicPath, 'error-404.html'));
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 80;

app.listen(PORT, '0.0.0.0', () => {
  logger.info("SERVER", `🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});

export default app;
