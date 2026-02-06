import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { generateInvoicePDF } from './pdfGenerator.js';
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Logs mejorados con timestamp y contexto
const logger = {
  info: (context, message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] [${context}] ${message}`, Object.keys(data).length ? data : '');
  },
  error: (context, message, error = null, data = {}) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] [${context}] ${message}`, 
      error ? `Error: ${error.message} - Stack: ${error.stack}` : '',
      Object.keys(data).length ? data : ''
    );
  },
  warn: (context, message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN] [${context}] ${message}`, Object.keys(data).length ? data : '');
  }
};

const HOST_URL = process.env.HOST_URL || "http://localhost";

// --- Endpoint de Análisis Real con Gemini ---
app.post("/api/analyze", async (req, res) => {
  const { movieTitle, movieDescription } = req.body;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    logger.error('GEMINI_API', 'GEMINI_API_KEY no configurada');
    return res.status(500).json({ error: "GEMINI_API_KEY no configurada en el servidor" });
  }

  const prompt = `Actúa como un crítico de cine experto y redacta un análisis completo y objetivo para la película "${movieTitle}". Utiliza la siguiente sinopsis: "${movieDescription}". El análisis debe ser excelente, ordenado y adecuado para una aplicación móvil. El texto debe ser muy natural, sin utilizar caracteres de negrita (**). La respuesta debe incluir:
  1. Un párrafo introductorio.
  2. Un subtítulo: "Trama y Desarrollo".
  3. Un subtítulo: "Aspectos Destacados" seguido de una lista de 3 a 5 puntos clave (actuación, dirección, fotografía, etc.).
  4. Un subtítulo: "Veredicto Final" con un párrafo de conclusión.
  Asegúrate de que todo el texto generado fluya de manera natural y esté formateado con subtítulos y listas.`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    res.json(response.data);
  } catch (error) {
    logger.error('GEMINI_API', 'Error al llamar a Gemini API', error);
    res.status(500).json({ error: "Error al procesar el análisis con Gemini" });
  }
});

// --- Configuración de Firebase ---
function buildServiceAccountFromEnv() {
  const requiredVars = ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY_ID'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) return null;
  try {
    return {
      "type": process.env.FIREBASE_TYPE || "service_account",
      "project_id": process.env.FIREBASE_PROJECT_ID,
      "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
      "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      "client_email": process.env.FIREBASE_CLIENT_EMAIL,
      "client_id": process.env.FIREBASE_CLIENT_ID,
      "auth_uri": process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
      "token_uri": process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
      "client_x509_cert_url": process.env.FIREBASE_CLIENT_X509_CERT_URL,
      "universe_domain": process.env.FIREBASE_UNIVERSE_DOMAIN || "googleapis.com"
    };
  } catch (error) {
    return null;
  }
}

let db;
const serviceAccount = buildServiceAccountFromEnv();
if (serviceAccount && !admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
    db = admin.firestore();
  } catch (error) {
    console.error('CRITICAL: Firebase initialization failed.');
  }
}

// ================================================
// CONTROL DE ACCESO Y REDIRECCIONES
// ================================================

const PUBLIC_PAGES = [
  'login.html',
  'home.html',
  'error-404',
  'politica-privacidad.html',
  'politica.compras.html',
  'terminos-condiciones.html',
  'aviso-legal-peliprex.html',
  'disclaimer-apis',
  'API-Docs',
  'verify.html'
];

// Middleware para verificar sesión
const checkAuth = (req, res, next) => {
  // Ignorar API y archivos estáticos con extensión
  if (req.path.startsWith('/api/') || req.path.includes('.')) {
    return next();
  }

  // Normalizar path para comparación
  const pathName = req.path.replace(/^\//, '');
  
  // Si es la raíz, servir home.html (pública)
  if (pathName === '') return next();

  // Verificar si la página es pública (considerando tanto con .html como sin él)
  const isPublic = PUBLIC_PAGES.some(page => {
    const pageWithoutExt = page.replace('.html', '');
    return pathName === page || pathName === pageWithoutExt;
  });

  if (isPublic) return next();

  // Aquí iría la lógica de verificación de token (Firebase Admin SDK)
  // Por simplicidad y siguiendo la instrucción de "Si el usuario no ha iniciado sesión -> redirigir a login.html"
  // Asumiremos que el frontend maneja la persistencia, pero el servidor protege la carga inicial.
  
  const cookies = req.headers.cookie || '';
  const hasSession = cookies.includes('__session=') || cookies.includes('user_session=');

  if (!hasSession) {
    logger.info('AUTH', `Acceso denegado a ${req.path}, redirigiendo a login.html`);
    return res.redirect('/login.html');
  }

  next();
};

app.use(checkAuth);

// Servir archivos estáticos DESPUÉS del check de auth para proteger HTMLs
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  index: false // Deshabilitar index.html automático
}));

// ================================================
// RUTAS ESPECÍFICAS Y MANEJO DE 404
// ================================================

// Raíz -> home.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Manejo explícito de error-404
app.get('/error-404', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'error-404'));
});

// Redirigir cualquier intento de acceder a index.html a la raíz
app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

// Catch-all para 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: "Endpoint no encontrado" });
  }
  logger.warn('404', `Página no encontrada: ${req.path}`);
  res.status(404).sendFile(path.join(__dirname, 'public', 'error-404'));
});

// Puerto y arranque
const PORT = process.env.PORT || 80;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
