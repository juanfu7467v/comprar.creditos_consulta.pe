import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import logger from "./utils/logger.js";
import apiRoutes from "./routes/index.js";
import { verifyFirebaseAuth } from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');

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
app.use(helmet({
  contentSecurityPolicy: false,
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

// Rutas de API
app.use("/api", apiRoutes);

// Archivos estáticos
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Mapeo de rutas para HTML (Clean URLs)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  
  const cleanPath = req.path.replace(/^\//, '') || 'home';
  const htmlPath = path.join(publicPath, `${cleanPath}.html`);
  
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath);
  }
  next();
});

// Redirección 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicPath, 'error-404.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logger.info('SERVER', `Servidor iniciado en el puerto ${PORT}`);
});
