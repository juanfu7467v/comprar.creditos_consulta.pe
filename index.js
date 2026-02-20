import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import cookieParser from "cookie-parser";
import moment from "moment-timezone";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { generateInvoicePDF } from './pdfGenerator.js';
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import { Resend } from "resend";
import helmet from "helmet";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');

// ================================================================
// 📋 LOGS MEJORADOS (DEFINIDO AL INICIO PARA EVITAR ERRORES)
// ================================================================

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

// ================================================================
// 🔒 CONFIGURACIÓN CORS MEJORADA - SOLO DOMINIOS ESPECÍFICOS
// ================================================================

const allowedOrigins = [
  'https://masitaprex.com',
  'https://www.masitaprex.com',
  'https://consulta-pe-abf99.firebaseapp.com',
  'https://consulta-pe-abf99.firebasestorage.app',
  'https://masitaprexv2.fly.dev'
];

app.use(cors({
  origin: function(origin, callback) {
    // Permitir solicitudes sin origin (como apps móviles, postman, etc) en desarrollo
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

// ================================================================
// 🔒 SEGURIDAD - CABECERAS CON HELMET (ACTUALIZADO CON HSTS Y CSP MEJORADA)
// ================================================================

// Lista completa de dominios para CSP
const cspDomains = [
  "'self'",
  "https://masitaprex.com",
  "https://auth.masitaprex.com",
  "https://peliprex-pe-v2.fly.dev",
  "https://1.bp.blogspot.com",
  "https://www.masitaprex.com",
  "https://consulta-pe-abf99.firebaseapp.com",
  "https://consulta-pe-abf99.firebasestorage.app",
  "https://masitaprexv2.fly.dev",
  "https://cdn-icons-png.flaticon.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://unpkg.com",
  "https://cdn.tailwindcss.com",
  "https://api.masitaprex.com",
  "https://m.facebook.com",
  "https://youtube.com",
  "https://www.youtube.com",
  "https://wa.me",
  "https://www.gstatic.com",
  "https://blogger.googleusercontent.com",
  "https://via.placeholder.com",
  "https://image.tmdb.org",
  "https://apis.google.com",
  "https://firebase.googleapis.com",
  "https://firestore.googleapis.com",
  "https://accounts.google.com",
  "https://securetoken.googleapis.com",
  "https://drive.google.com",
  "https://generativelanguage.googleapis.com",
  "https://cdn.jsdelivr.net",
  "https://sdk.mercadopago.com",
  "https://mercadopago.com",
  "https://api.mercadopago.com",
  "https://sdk.mercadopago.com",
"https://www.mercadopago.com.pe", "https://www.mercadopago.com", "https://pago.mercadopago.com.pe",
"https://api.mercadopago.com",
"https://http2.mlstatic.com",
  "https://*.mercadopago.com",
"https://*.mercadolibre.com",
"https://www.mercadopago.com.pe",
  "https://www.appcreator24.com",
  "https://img.utdstc.com",
  "https://com-masitaorex.uptodown.com",
  "https://stc.utdstc.com",
  "https://apk.e-droid.net",
  "https://apkpure.com",
  "https://placehold.co",
  "https://www.google.com",
  "https://google.com",
  "https://github.com",
  "https://www.github.com",
  "https://api.github.com",
  "https://identitytoolkit.googleapis.com",
  "https://www.facebook.com",
  "data:",
  "blob:",
  "https://*.firebaseio.com",
  "https://*.googleapis.com"
];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", ...cspDomains],
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
    reportOnly: false,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  originAgentCluster: false,
  dnsPrefetchControl: { allow: true },
  frameguard: { action: 'sameorigin' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'all' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
}));

// Desactivar CSP en rutas de API para evitar problemas
app.use('/api', (req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  next();
});

// ================================================================
// ✉️ CONFIGURACIÓN DE RESEND
// ================================================================

const resend = new Resend(process.env.RESEND_API_KEY);

// ================================================================
// 🔍 HELPERS DE IP
// ================================================================

function getClientIp(req) {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.length > 0) {
    return xForwardedFor.split(",")[0].trim();
  }
  return req.ip;
}

// ================================================================
// 🛡️ SISTEMA DE BLOQUEO DE INTENTOS FALLIDOS (CACHÉ EN MEMORIA)
// ================================================================

const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION_HOURS = 6;
const BLOCK_DURATION_MS = BLOCK_DURATION_HOURS * 60 * 60 * 1000;

// Caché en memoria para intentos de login (más económico que Firestore)
const loginAttemptsCache = new Map();

// Limpiar entradas expiradas cada hora
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [email, data] of loginAttemptsCache.entries()) {
    // Si está bloqueado y el bloqueo expiró, o si no hay actividad reciente (> 24h)
    if (data.blockedUntil && data.blockedUntil < now) {
      loginAttemptsCache.delete(email);
      expiredCount++;
    } else if (!data.blockedUntil && (now - data.lastAttempt) > 24 * 60 * 60 * 1000) {
      // Limpiar intentos no bloqueados después de 24 horas sin actividad
      loginAttemptsCache.delete(email);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    logger.info('CACHE_CLEANUP', `Limpiadas ${expiredCount} entradas expiradas de loginAttemptsCache`);
  }
}, 60 * 60 * 1000); // Cada hora

/**
 * Obtener información de geolocalización por IP
 */
async function getLocationFromIP(ip) {
  try {
    // Evitar IPs locales
    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return { city: 'Local', region: 'Localhost', country: 'Local Network' };
    }

    const response = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 3000 });
    const data = response.data;

    return {
      city: data.city || 'Desconocida',
      region: data.region || 'Desconocida',
      country: data.country_name || 'Desconocido'
    };
  } catch (error) {
    logger.warn('GEOLOCATION', 'Error obteniendo ubicación', { ip, error: error.message });
    return { city: 'Desconocida', region: 'Desconocida', country: 'Desconocido' };
  }
}

/**
 * Verificar si un usuario está bloqueado (usando caché en memoria)
 */
async function checkLoginBlock(email) {
  const context = 'CHECK_LOGIN_BLOCK';

  try {
    const now = Date.now();
    const attemptData = loginAttemptsCache.get(email);

    if (!attemptData) {
      return { isBlocked: false, attempts: 0 };
    }

    const { attempts, blockedUntil } = attemptData;

    // Si hay bloqueo activo
    if (blockedUntil && blockedUntil > now) {
      const remainingMinutes = Math.ceil((blockedUntil - now) / (1000 * 60));
      logger.warn(context, 'Usuario bloqueado', { 
        email, 
        attempts, 
        blockedUntil: new Date(blockedUntil).toISOString(),
        remainingMinutes 
      });

      return {
        isBlocked: true,
        attempts,
        blockedUntil: new Date(blockedUntil),
        remainingMinutes
      };
    }

    // Si el bloqueo expiró, resetear intentos
    if (blockedUntil && blockedUntil <= now) {
      loginAttemptsCache.delete(email);
      logger.info(context, 'Bloqueo expirado, intentos reseteados', { email });
      return { isBlocked: false, attempts: 0 };
    }

    // No bloqueado, devolver intentos actuales
    return { isBlocked: false, attempts: attempts || 0 };

  } catch (error) {
    logger.error(context, 'Error verificando bloqueo', error, { email });
    return { isBlocked: false, attempts: 0, error: true };
  }
}

/**
 * Validar coherencia del dispositivo
 */
function validateDeviceCoherence(deviceModel, userAgent) {
  // Implementación básica: Si el modelo del dispositivo es muy diferente del user agent, puede ser sospechoso
  if (!deviceModel || deviceModel === 'Unknown Device') return true;
  
  // Aquí puedes agregar lógica más compleja si es necesario
  return true;
}

/**
 * Generar fingerprint del dispositivo
 */
function generateFingerprint(req) {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLang = req.headers['accept-language'] || '';
  const encoding = req.headers['accept-encoding'] || '';
  
  const fingerprint = `${userAgent}|${acceptLang}|${encoding}`;
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

/**
 * Registrar un intento fallido de login
 */
async function registerFailedLogin(email, req, deviceModel = null) {
  const context = 'REGISTER_FAILED_LOGIN';

  try {
    const now = Date.now();
    const attemptData = loginAttemptsCache.get(email) || { 
      attempts: 0, 
      firstAttempt: now,
      lastAttempt: now,
      ips: [],
      userAgents: []
    };

    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Actualizar datos
    attemptData.attempts += 1;
    attemptData.lastAttempt = now;
    
    if (!attemptData.ips.includes(ip)) {
      attemptData.ips.push(ip);
    }
    
    if (!attemptData.userAgents.includes(userAgent)) {
      attemptData.userAgents.push(userAgent);
    }

    // Verificar coherencia del dispositivo (opcional)
    const isCoherent = validateDeviceCoherence(deviceModel, userAgent);
    const newAttempts = attemptData.attempts;

    // Si alcanza el máximo o hay incoherencia, bloquear
    if (newAttempts >= MAX_LOGIN_ATTEMPTS || !isCoherent) {
      const blockedUntil = now + BLOCK_DURATION_MS;

      attemptData.blockedUntil = blockedUntil;
      attemptData.blockedAt = now;
      attemptData.isSuspicious = !isCoherent;

      loginAttemptsCache.set(email, attemptData);

      logger.warn(context, '🚨 Usuario BLOQUEADO o INTENTO SOSPECHOSO', { 
        email, 
        attempts: newAttempts, 
        isCoherent,
        ip 
      });

      // Enviar correo de alerta
      await sendSuspiciousLoginEmail(email, ip, userAgent, deviceModel, !isCoherent);

    } else {
      // Incrementar contador
      loginAttemptsCache.set(email, attemptData);

      logger.warn(context, `⚠️ Intento fallido registrado (${newAttempts}/${MAX_LOGIN_ATTEMPTS})`, { 
        email, 
        attempts: newAttempts,
        ip 
      });
    }

  } catch (error) {
    logger.error(context, 'Error registrando intento fallido', error, { email });
  }
}

/**
 * Enviar correo de alerta por intento sospechoso
 */
async function sendSuspiciousLoginEmail(email, ip, userAgent, deviceModel = null, isIncoherent = false) {
  const context = 'SEND_SUSPICIOUS_LOGIN_EMAIL';

  try {
    logger.info(context, '📧 Enviando correo de alerta de seguridad', { email, ip });

    // Obtener ubicación
    const location = await getLocationFromIP(ip);
    const locationString = `${location.city}, ${location.region}, ${location.country}`;

    // Obtener nombre de usuario
    let userName = email.split('@')[0];
    try {
      const userSnap = await db.collection('usuarios').where('email', '==', email).limit(1).get();
      if (!userSnap.empty) {
        const userData = userSnap.docs[0].data();
        userName = userData.name || userData.displayName || userName;
      }
    } catch (err) {
      logger.warn(context, 'No se pudo obtener nombre de usuario', { email });
    }

    // Leer plantilla HTML
    const templatePath = path.join(__dirname, 'emails', 'intento-inicio-seccion-sospechoso.html');

    if (!fs.existsSync(templatePath)) {
      logger.error(context, 'Plantilla de correo no encontrada', null, { templatePath });
      throw new Error('Plantilla de correo no encontrada');
    }

    let htmlContent = fs.readFileSync(templatePath, 'utf-8');

    // Reemplazar variables
    const now = new Date();
    const fechaHora = now.toLocaleString('es-PE', { 
      dateStyle: 'full', 
      timeStyle: 'medium',
      timeZone: 'America/Lima'
    });

    const displayDevice = deviceModel && deviceModel !== 'Unknown Device' ? deviceModel : userAgent.substring(0, 100);

    htmlContent = htmlContent.replace(/{{nombre}}/g, userName);
    htmlContent = htmlContent.replace(/{{ubicacion}}/g, locationString);
    htmlContent = htmlContent.replace(/{{ip}}/g, ip);
    htmlContent = htmlContent.replace(/{{fecha_hora}}/g, fechaHora);
    htmlContent = htmlContent.replace(/{{dispositivo}}/g, displayDevice);

    if (isIncoherent) {
      htmlContent = htmlContent.replace('Actividad Sospechosa Detectada.', '⚠️ Incoherencia de Dispositivo Detectada.');
    }

    // Enviar correo usando Resend
    const result = await resend.emails.send({
      from: 'Seguridad Masitaprex <no-reply@masitaprex.com>',
      to: email,
      subject: isIncoherent ? '🚨 ALERTA: Intento de acceso sospechoso detectado' : '🚨 ALERTA: Cuenta bloqueada por intentos sospechosos',
      html: htmlContent
    });

    logger.info(context, '✅ Correo de alerta enviado exitosamente', { 
      email, 
      resendId: result.id,
      ip,
      location: locationString
    });

    return { success: true, id: result.id };

  } catch (error) {
    logger.error(context, '❌ Error enviando correo de alerta', error, { 
      email, 
      ip,
      errorMessage: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Resetear intentos fallidos (después de login exitoso) - usando caché en memoria
 */
async function resetLoginAttempts(email) {
  const context = 'RESET_LOGIN_ATTEMPTS';

  try {
    if (loginAttemptsCache.has(email)) {
      loginAttemptsCache.delete(email);
      logger.info(context, '✅ Intentos de login reseteados (eliminados de caché)', { email });
    }
  } catch (error) {
    logger.error(context, 'Error reseteando intentos', error, { email });
  }
}

// ================================================================
// 🔐 CONFIGURACIÓN DE RUTAS Y CONTROL DE ACCESO
// ================================================================

/**
 * Rutas públicas que NO requieren autenticación
 */
const PUBLIC_ROUTES = [
  '/login',
  '/login.html',
  '/register',
  '/register.html',
  '/error-404',
  '/error-404.html',
  '/',
  '/home',
  '/home.html',
  '/politica-privacidad',
  '/politica-privacidad.html',
  '/terminos-condiciones',
  '/terminos-condiciones.html',
  '/politica.compras',
  '/politica.compras.html',
  '/aviso-legal-peliprex',
  '/aviso-legal-peliprex.html',
  '/disclaimer-apis',
  '/disclaimer-apis.html',
  '/API-Docs',
  '/API-Docs.html',
  '/verify',
  '/verify.html'
];

/**
 * Rutas protegidas que requieren autenticación
 */
const PROTECTED_ROUTES = [
  '/favoritos',
  '/favoritos.html',
  '/historial',
  '/historial.html',
  '/api/proxy-consulta',
  '/planes',
  '/planes.html',
  '/PeliPREX',
  '/PeliPREX.html',
  '/peliculas',
  '/actividad',
  '/actividad.html',
  '/user/activity',
  '/api-key',
  '/api-key.html',
  '/checkout',
  '/checkout.html',
  '/consultaPe-vercion-web',
  '/consultaPe-vercion-web.html'
];

/**
 * Rutas de API que NO requieren middleware de autenticación
 */
const PUBLIC_API_ROUTES = [
  '/api/auth',
  '/api/login',
  '/api/login-success',
  '/api/register',
  '/api/config',
  '/api/health',
  '/api/webhook',
  '/api/validate-recaptcha',
  '/api/pay',
  '/api/webhook/mercadopago',
  '/api/payment',
  '/api/generate-invoice',
  '/api/invoice-options',
  '/api/debug/firebase',
  '/api/admin/clear-cache',
  '/api/analyze',
  '/api/notify-verification',
  '/api/report-failed-login'
];

// ================================================================
// 🔥 CONFIGURACIÓN DE FIREBASE
// ================================================================

function buildServiceAccountFromEnv() {
  logger.info('FIREBASE_CONFIG', 'Construyendo service account desde variables de entorno individuales');

  const requiredVars = [
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY_ID'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.error('FIREBASE_CONFIG', `Variables de Firebase faltantes: ${missingVars.join(', ')}`);
    return null;
  }

  try {
    const serviceAccount = {
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

    logger.info('FIREBASE_CONFIG', 'Service account construido exitosamente', {
      project_id: serviceAccount.project_id,
      client_email: serviceAccount.client_email,
      has_private_key: !!serviceAccount.private_key
    });

    return serviceAccount;

  } catch (error) {
    logger.error('FIREBASE_CONFIG', 'Error construyendo service account', error);
    return null;
  }
}

let db;
let bucket;
const serviceAccount = buildServiceAccountFromEnv();

if (serviceAccount && !admin.apps.length) {
  try {
    logger.info('FIREBASE', 'Inicializando Firebase Admin...');

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });

    db = admin.firestore();
    bucket = admin.storage().bucket();

    db.settings({
      ignoreUndefinedProperties: true
    });

    logger.info('FIREBASE', 'Firebase Admin inicializado correctamente', {
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });

    const firestoreCheck = await db.collection('_healthcheck').doc('connection').get()
      .then(() => ({ status: 'connected', message: 'Conexión a Firestore exitosa' }))
      .catch(error => ({ status: 'error', message: error.message }));

    logger.info('FIRESTORE', 'Verificación de conexión', firestoreCheck);

  } catch (error) {
    logger.error('FIREBASE', 'Error crítico al inicializar Firebase Admin', error, {
      projectId: serviceAccount?.project_id,
      clientEmail: serviceAccount?.client_email
    });

    console.error('CRITICAL: Firebase no pudo inicializarse. Algunas funciones no estarán disponibles.');
  }
} else if (admin.apps.length) {
  db = admin.firestore();
  bucket = admin.storage().bucket();
  logger.info('FIREBASE', 'Usando instancia existente de Firebase');
} else {
  logger.error('FIREBASE', 'No se pudo inicializar Firebase - Service account no disponible');
}

// ================================================================
// 🔐 CONFIGURACIÓN DE RECAPTCHA - MEJORADA PARA MAYOR ESTABILIDAD
// ================================================================

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_CLAVE_SECRETA;
const RECAPTCHA_SITE_KEY = "6Lc4OGIsAAAAAPrAnOprbzd-ATbUOWHXK3Yl_bVy";

async function validateRecaptcha(recaptchaResponse) {
  const context = 'RECAPTCHA_VALIDATION';

  if (!RECAPTCHA_SECRET_KEY) {
    logger.error(context, 'Clave secreta de reCAPTCHA no configurada');
    throw new Error('Recaptcha secret key not configured');
  }

  if (!recaptchaResponse) {
    throw new Error('reCAPTCHA response is required');
  }

  let attempts = 0;
  const maxAttempts = 3;
  const baseDelay = 500; // 500ms

  while (attempts < maxAttempts) {
    try {
      const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
      
      const params = new URLSearchParams();
      params.append('secret', RECAPTCHA_SECRET_KEY);
      params.append('response', recaptchaResponse);

      const response = await axios.post(verificationUrl, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 8000 // 8 segundos de timeout
      });

      const data = response.data;

      if (data.success) {
        logger.info(context, '✅ reCAPTCHA validado exitosamente', {
          score: data.score,
          action: data.action
        });
        return { success: true, score: data.score, action: data.action };
      } else {
        const errorCodes = data['error-codes'] || ['unknown-error'];
        logger.warn(context, '❌ reCAPTCHA rechazado', { errorCodes });

        const shouldRetry = !errorCodes.some(code => 
          code === 'timeout-or-duplicate' || 
          code === 'invalid-input-response' ||
          code === 'missing-input-response' ||
          code === 'bad-request'
        );

        if (!shouldRetry || attempts === maxAttempts - 1) {
          throw new Error('reCAPTCHA validation failed: ' + errorCodes.join(', '));
        }

        // Esperar antes de reintentar (backoff exponencial)
        const delay = baseDelay * Math.pow(2, attempts);
        logger.info(context, `Reintentando validación reCAPTCHA en ${delay}ms`, { attempt: attempts + 1 });
        await new Promise(resolve => setTimeout(resolve, delay));
        attempts++;
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        logger.warn(context, 'Timeout en validación reCAPTCHA', { 
          attempt: attempts + 1,
          maxAttempts,
          error: error.message 
        });

        if (attempts === maxAttempts - 1) {
          logger.error(context, 'Máximo de reintentos alcanzado para validación reCAPTCHA', error);
          throw new Error('reCAPTCHA validation timeout after multiple attempts');
        }

        // Esperar antes de reintentar
        const delay = baseDelay * Math.pow(2, attempts);
        logger.info(context, `Reintentando después de timeout en ${delay}ms`, { attempt: attempts + 1 });
        await new Promise(resolve => setTimeout(resolve, delay));
        attempts++;
      } else {
        logger.error(context, 'Error en validación reCAPTCHA', error);
        throw error;
      }
    }
  }

  throw new Error('reCAPTCHA validation failed after maximum attempts');
}

// ================================================================
// 💳 CONFIGURACIÓN DE MERCADO PAGO
// ================================================================

const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const HOST_URL = process.env.HOST_URL || `https://${process.env.FLY_APP_NAME}.fly.dev`;

if (!MERCADOPAGO_ACCESS_TOKEN) {
  logger.error('CONFIG', 'MERCADOPAGO_ACCESS_TOKEN no está configurado');
  console.warn('ADVERTENCIA: MERCADOPAGO_ACCESS_TOKEN no configurado. Pagos no disponibles.');
}

const mpClient = MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({
  accessToken: MERCADOPAGO_ACCESS_TOKEN.trim(),
  options: { timeout: 10000 }
}) : null;

const PAQUETES_CREDITOS = { 10: 60, 20: 125, 30: 200, 50: 330, 100: 700, 200: 1500 };
const PLANES_ILIMITADOS = { 60: 7, 80: 15, 110: 30, 160: 60, 510: 70 };

const processedPaymentsCache = new Map();
const paymentLocks = new Map();

// ================================================================
// 💰 FUNCIONES DE PAGO Y BENEFICIOS
// ================================================================

async function acquirePaymentLock(paymentRef, maxWaitMs = 10000) {
  const context = 'PAYMENT_LOCK';
  const startTime = Date.now();

  while (paymentLocks.has(paymentRef)) {
    if (Date.now() - startTime > maxWaitMs) {
      logger.warn(context, 'Timeout esperando lock', { paymentRef, waitedMs: maxWaitMs });
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  paymentLocks.set(paymentRef, Date.now());
  logger.info(context, '🔒 Lock adquirido', { paymentRef });
  return true;
}

function releasePaymentLock(paymentRef) {
  const context = 'PAYMENT_LOCK';
  paymentLocks.delete(paymentRef);
  logger.info(context, '🔓 Lock liberado', { paymentRef });
}

async function checkFileExistsInStorage(fileName) {
  const context = 'STORAGE_CHECK';

  if (!bucket) {
    logger.error(context, 'Firebase Storage no está inicializado');
    return { exists: false, url: null };
  }

  try {
    const file = bucket.file(fileName);
    const [exists] = await file.exists();

    if (exists) {
      const [metadata] = await file.getMetadata();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

      logger.info(context, 'Archivo ya existe en Storage', { fileName, publicUrl });
      return { exists: true, url: publicUrl, metadata };
    }

    logger.info(context, 'Archivo no existe en Storage', { fileName });
    return { exists: false, url: null };

  } catch (error) {
    logger.error(context, 'Error verificando existencia en Storage', error, { fileName });
    return { exists: false, url: null, error: error.message };
  }
}

async function uploadPDFToStorage(pdfPath, paymentId) {
  const context = 'UPLOAD_PDF';

  if (!bucket) {
    logger.error(context, 'Firebase Storage no está inicializado');
    throw new Error('Firebase Storage not initialized');
  }

  try {
    logger.info(context, 'Intentando subir PDF a Firebase Storage', { pdfPath, paymentId });

    const fileName = `invoices/${paymentId}.pdf`;

    const fileCheck = await checkFileExistsInStorage(fileName);
    if (fileCheck.exists && fileCheck.url) {
      logger.info(context, '📝 PDF ya existe en Storage, devolviendo URL existente', {
        paymentId,
        url: fileCheck.url
      });
      return fileCheck.url;
    }

    const file = bucket.file(fileName);

    await bucket.upload(pdfPath, {
      destination: fileName,
      metadata: {
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="Boleta_ConsultaPE.pdf"',
        metadata: {
          paymentId: paymentId,
          uploadedAt: new Date().toISOString(),
          type: 'boleta_electronica'
        }
      }
    });

    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    logger.info(context, '✅ PDF subido exitosamente a Storage', {
      paymentId,
      fileName,
      publicUrl,
      size: fs.statSync(pdfPath).size
    });

    return publicUrl;

  } catch (error) {
    logger.error(context, '❌ Error subiendo PDF a Storage', error, { pdfPath, paymentId });
    throw error;
  }
}

async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRef) {
  const context = 'OTORGAR_BENEFICIO';

  if (!db) {
    logger.error(context, 'Firebase DB no está inicializado', null, { uid, paymentRef });
    return { status: 'error', message: 'Database not initialized' };
  }

  if (!uid) {
    logger.error(context, 'UID no proporcionado', null, { paymentRef, montoPagado });
    return { status: 'error', message: 'No UID provided' };
  }

  const paymentRefString = String(paymentRef);

  if (processedPaymentsCache.has(paymentRefString)) {
    const cachedData = processedPaymentsCache.get(paymentRefString);
    logger.warn(context, '🚫 Pago ya procesado en cache de memoria (idempotencia)', {
      uid,
      paymentRef: paymentRefString,
      processor,
      procesadoOriginalmentePor: cachedData.processor,
      procesadoEn: cachedData.timestamp
    });
    return {
      status: 'already_processed',
      message: 'Payment already processed in memory cache',
      originalProcessor: cachedData.processor,
      processedAt: cachedData.timestamp
    };
  }

  const lockAcquired = await acquirePaymentLock(paymentRefString);
  if (!lockAcquired) {
    logger.error(context, '❌ No se pudo adquirir lock para procesar pago', null, {
      uid, paymentRef: paymentRefString
    });
    return {
      status: 'error',
      message: 'Could not acquire payment lock - concurrent processing detected'
    };
  }

  const pagoDoc = db.collection("pagos_registrados").doc(paymentRefString);

  try {
    const doc = await pagoDoc.get();

    if (doc.exists) {
      const existingData = doc.data();

      if (existingData.procesado === true && existingData.estado === "approved") {
        logger.warn(context, '🚫 Pago ya procesado anteriormente en Firestore (idempotencia)', {
          uid,
          paymentRef: paymentRefString,
          procesadoEn: existingData.procesadoEn?.toDate?.() || existingData.procesadoEn,
          processor: existingData.procesadoPor,
          pdfUrl: existingData.pdfUrl || null
        });

        processedPaymentsCache.set(paymentRefString, {
          uid,
          timestamp: existingData.procesadoEn?.toDate?.()?.toISOString() || new Date().toISOString(),
          processor: existingData.procesadoPor,
          status: 'already_processed',
          pdfUrl: existingData.pdfUrl || null
        });

        releasePaymentLock(paymentRefString);

        return {
          status: 'already_processed',
          data: existingData,
          message: 'Payment was already processed successfully',
          creditosOtorgados: existingData.creditosOtorgados || 0,
          creditosNuevos: existingData.creditosNuevos || 0,
          planOtorgado: existingData.planOtorgado || null,
          pdfUrl: existingData.pdfUrl || null
        };
      }
    }

    logger.info(context, '✅ Procesando nuevo pago', {
      uid, email, montoPagado, processor, paymentRef: paymentRefString
    });

    await pagoDoc.set({
      uid,
      email,
      monto: montoPagado,
      processor,
      fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
      estado: "processing",
      procesado: false,
      intentoProcesamiento: new Date().toISOString()
    }, { merge: true });

    const userDoc = db.collection("usuarios").doc(uid);

    const result = await db.runTransaction(async (t) => {
      const user = await t.get(userDoc);
      if (!user.exists) {
        logger.error(context, 'Usuario no encontrado en Firestore', null, { uid });
        throw new Error(`User ${uid} not found`);
      }

      const userData = user.data();
      let descripcion = "";
      const montoNum = Number(montoPagado);
      let creditosOtorgados = 0;
      let planOtorgado = null;

      const creditosActuales = userData.creditos || 0;
      const tipoPlanActual = userData.tipoPlan || "creditos";
      const duracionDiasActual = userData.duracionDias || 0;
      const fechaActivacionActual = userData.fechaActivacion;
      const planIlimitadoHastaActual = userData.planIlimitadoHasta;

      logger.info(context, '📊 Estado actual del usuario', {
        uid,
        creditosActuales,
        tipoPlanActual,
        duracionDiasActual,
        fechaActivacionActual: fechaActivacionActual?.toDate?.() || null,
        planIlimitadoHasta: planIlimitadoHastaActual?.toDate?.() || null
      });

      if (PAQUETES_CREDITOS[montoNum]) {
        creditosOtorgados = PAQUETES_CREDITOS[montoNum];
        const nuevosCreditos = creditosActuales + creditosOtorgados;

        t.update(userDoc, {
          creditos: nuevosCreditos,
          tipoPlan: "creditos",
          fechaActivacion: admin.firestore.FieldValue.serverTimestamp(),
          ultimaCompra: admin.firestore.FieldValue.serverTimestamp()
        });

        descripcion = `${creditosOtorgados} Créditos`;
        logger.info(context, '💳 Créditos otorgados', {
          uid,
          creditosOtorgados,
          montoPagado,
          creditosAnteriores: creditosActuales,
          creditosNuevos: nuevosCreditos,
          tipoPlanAnterior: tipoPlanActual,
          tipoPlanNuevo: "creditos"
        });

      } else if (PLANES_ILIMITADOS[montoNum]) {
        const diasNuevos = PLANES_ILIMITADOS[montoNum];
        let duracionTotalDias;
        let fechaFinPlan;
        let fechaActivacion;

        const ahora = new Date();
        const tienePlanIlimitadoActivo = tipoPlanActual === "ilimitado" &&
          fechaActivacionActual &&
          planIlimitadoHastaActual &&
          planIlimitadoHastaActual.toDate() > ahora;

        if (tienePlanIlimitadoActivo) {
          fechaActivacion = fechaActivacionActual.toDate();
          duracionTotalDias = duracionDiasActual + diasNuevos;
          fechaFinPlan = moment(fechaActivacion).add(duracionTotalDias, 'days').toDate();

          logger.info(context, '➕ Acumulando días al plan ilimitado existente', {
            uid,
            diasAnteriores: duracionDiasActual,
            diasNuevos,
            duracionTotalDias,
            fechaActivacionOriginal: fechaActivacion.toISOString(),
            fechaFinAnterior: planIlimitadoHastaActual.toDate().toISOString(),
            nuevaFechaFin: fechaFinPlan.toISOString()
          });

        } else {
          fechaActivacion = ahora;
          duracionTotalDias = diasNuevos;
          fechaFinPlan = moment(ahora).add(diasNuevos, 'days').toDate();

          logger.info(context, '🆕 Creando nuevo plan ilimitado', {
            uid,
            diasNuevos,
            fechaInicio: fechaActivacion.toISOString(),
            fechaFin: fechaFinPlan.toISOString(),
            razon: !tienePlanIlimitadoActivo ? 'nuevo_plan' : 'plan_vencido_o_inexistente'
          });
        }

        t.update(userDoc, {
          duracionDias: duracionTotalDias,
          planIlimitadoHasta: fechaFinPlan,
          creditos: 0,
          tipoPlan: "ilimitado",
          fechaActivacion: tienePlanIlimitadoActivo
            ? fechaActivacionActual
            : admin.firestore.FieldValue.serverTimestamp(),
          ultimaCompra: admin.firestore.FieldValue.serverTimestamp()
        });

        planOtorgado = {
          dias: duracionTotalDias,
          diasAgregados: diasNuevos,
          fechaFin: fechaFinPlan
        };
        descripcion = `Plan Ilimitado (${diasNuevos} días${duracionTotalDias > diasNuevos ? ' - Total acumulado: ' + duracionTotalDias + ' días' : ''})`;

        logger.info(context, '✨ Plan ilimitado actualizado exitosamente', {
          uid,
          diasAgregados: diasNuevos,
          duracionTotal: duracionTotalDias,
          fechaFin: fechaFinPlan.toISOString(),
          creditosReseteados: true,
          tipoPlanAnterior: tipoPlanActual,
          tipoPlanNuevo: "ilimitado"
        });

        creditosOtorgados = 0;

      } else {
        logger.warn(context, '⚠️ Monto no coincide con ningún paquete', { montoPagado, uid });
        descripcion = `Pago de S/ ${montoPagado}`;
      }

      t.update(pagoDoc, {
        descripcion,
        procesado: true,
        estado: "approved",
        procesadoEn: admin.firestore.FieldValue.serverTimestamp(),
        procesadoPor: processor,
        creditosOtorgados,
        creditosAnteriores: creditosActuales,
        creditosNuevos: PLANES_ILIMITADOS[montoNum] ? 0 : (creditosActuales + creditosOtorgados),
        planOtorgado,
        tipoPlanAnterior: tipoPlanActual,
        tipoPlanNuevo: PLANES_ILIMITADOS[montoNum] ? "ilimitado" : "creditos"
      });

      return {
        status: 'success',
        creditosOtorgados,
        creditosAnteriores: creditosActuales,
        creditosNuevos: PLANES_ILIMITADOS[montoNum] ? 0 : (creditosActuales + creditosOtorgados),
        planOtorgado,
        descripcion,
        tipoPlanAnterior: tipoPlanActual,
        tipoPlanNuevo: PLANES_ILIMITADOS[montoNum] ? "ilimitado" : "creditos"
      };
    });

    try {
      logger.info(context, '📄 Generando Boleta Electrónica automáticamente', { paymentRef: paymentRefString });

      const invoiceData = {
        orderId: paymentRefString,
        date: new Date().toLocaleString('es-PE'),
        email: email || 'cliente@example.com',
        amount: montoPagado,
        credits: result.creditosOtorgados || 0,
        description: result.descripcion || 'Créditos Consulta PE',
        type: 'boleta'
      };

      const pdfPath = await generateInvoicePDF(invoiceData);
      const localPdfPath = path.join(__dirname, 'public', pdfPath);

      const storageUrl = await uploadPDFToStorage(localPdfPath, paymentRefString);

      await pagoDoc.update({
        pdfUrl: storageUrl,
        pdfGeneradoEn: admin.firestore.FieldValue.serverTimestamp(),
        tipoComprobante: 'boleta',
        storagePath: `invoices/${paymentRefString}.pdf`
      });

      if (fs.existsSync(localPdfPath)) {
        fs.unlinkSync(localPdfPath);
      }

      logger.info(context, '✅ Boleta generada y subida a Storage exitosamente', {
        paymentRef: paymentRefString,
        storageUrl
      });

      result.pdfUrl = storageUrl;

    } catch (pdfError) {
      logger.error(context, '⚠️ Error generando/subiendo PDF (no crítico)', pdfError, {
        paymentRef: paymentRefString
      });
    }

    processedPaymentsCache.set(paymentRefString, {
      uid,
      timestamp: new Date().toISOString(),
      processor,
      status: 'processed',
      pdfUrl: result.pdfUrl || null
    });

    setTimeout(() => {
      processedPaymentsCache.delete(paymentRefString);
      logger.info(context, '🗑️ Pago removido del cache', { paymentRef: paymentRefString });
    }, 2 * 60 * 60 * 1000);

    logger.info(context, '✅ Transacción completada exitosamente', { uid, result });

    // Obtener nombre del usuario para el correo
    let userName = email.split('@')[0];
    try {
      const userSnap = await db.collection('usuarios').doc(uid).get();
      if (userSnap.exists) {
        const userData = userSnap.data();
        userName = userData.name || userData.displayName || userName;
      }
    } catch (err) {
      logger.warn(context, 'No se pudo obtener nombre de usuario para el correo', { uid });
    }

    // Enviar correo de confirmación de compra automáticamente
    enviarCorreoCompra(
      email,
      userName,
      paymentRefString,
      montoPagado,
      result.descripcion || 'Servicio Masitaprex',
      result.pdfUrl
    ).catch(err => logger.error(context, 'Error en envío de correo asíncrono', err));

    releasePaymentLock(paymentRefString);

    return result;

  } catch (error) {
    logger.error(context, '❌ Error en otorgarBeneficio', error, { uid, paymentRef: paymentRefString, montoPagado });

    try {
      await pagoDoc.update({
        procesado: false,
        estado: "error",
        error: error.message,
        errorStack: error.stack,
        fallidoEn: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (updateError) {
      logger.error(context, 'Error al actualizar estado de fallo', updateError, { paymentRef: paymentRefString });
    }

    releasePaymentLock(paymentRefString);

    return { status: 'error', message: error.message, error: error.stack };
  }
}

// ================================================================
// 🔥 FUNCIÓN: ENVÍO DE CORREO DE BIENVENIDA POST-VERIFICACIÓN
// ================================================================

async function enviarBienvenida(email, nombre) {
  const context = 'ENVIAR_BIENVENIDA';
  
  try {
    logger.info(context, '📧 Enviando correo de bienvenida', { email, nombre });
    
    const templatePath = path.join(__dirname, 'emails', 'bienvenida-usuario-nuevo.html');
    
    if (!fs.existsSync(templatePath)) {
      logger.error(context, 'Plantilla de correo no encontrada', null, { templatePath });
      throw new Error('Plantilla de correo no encontrada');
    }
    
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');
    
    htmlContent = htmlContent.replace(/{{nombre}}/g, nombre);
    
    logger.info(context, 'Contenido HTML cargado correctamente', {
      templatePath,
      contentLength: htmlContent.length,
      nombre
    });
    
    const result = await resend.emails.send({
      from: 'Masitaprex <no-reply@masitaprex.com>',
      to: email,
      subject: 'Bienvenido a Masitaprex',
      html: htmlContent
    });

    logger.info(context, '✅ Correo de bienvenida enviado exitosamente', { 
      email, 
      resendId: result.id 
    });
    
    return { success: true, id: result.id };
    
  } catch (error) {
    logger.error(context, '❌ Error enviando correo de bienvenida', error, { 
      email, 
      nombre,
      errorMessage: error.message,
      errorResponse: error.response?.data || error.response?.body || null
    });
    return { success: false, error: error.message };
  }
}

/**
 * Enviar correo de confirmación de compra exitosa
 */
async function enviarCorreoCompra(email, nombre, orderId, monto, descripcion, urlBoleta) {
  const context = 'ENVIAR_CORREO_COMPRA';
  
  try {
    logger.info(context, '📧 Enviando correo de compra exitosa', { email, orderId });
    
    const templatePath = path.join(__dirname, 'emails', 'compra-exitosa.html');
    
    if (!fs.existsSync(templatePath)) {
      logger.error(context, 'Plantilla de correo no encontrada', null, { templatePath });
      return { success: false, error: 'Plantilla no encontrada' };
    }
    
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');
    
    // Reemplazar variables en la plantilla
    htmlContent = htmlContent.replace(/{{nombre}}/g, nombre || 'Cliente');
    htmlContent = htmlContent.replace(/{{orderId}}/g, orderId);
    htmlContent = htmlContent.replace(/{{monto}}/g, monto);
    htmlContent = htmlContent.replace(/{{descripcion}}/g, descripcion);
    htmlContent = htmlContent.replace(/{{url_boleta}}/g, urlBoleta || 'https://masitaprex.com/historial');
    
    const result = await resend.emails.send({
      from: 'Facturación Masitaprex <facturacion@masitaprex.com>',
      to: email,
      subject: `Confirmación de Compra #${orderId} - Masitaprex`,
      html: htmlContent
    });

    logger.info(context, '✅ Correo de compra enviado exitosamente', { 
      email, 
      orderId,
      resendId: result.id 
    });
    
    return { success: true, id: result.id };
    
  } catch (error) {
    logger.error(context, '❌ Error enviando correo de compra', error, { 
      email, 
      orderId
    });
    return { success: false, error: error.message };
  }
}

// ================================================================
// 🔐 FUNCIÓN PARA CREAR SESSION COOKIE DE FIREBASE
// ================================================================

async function createSessionCookie(idToken) {
  const context = 'CREATE_SESSION_COOKIE';
  
  try {
    // 5 días de expiración
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 días en milisegundos
    
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    
    logger.info(context, 'Session cookie creada exitosamente');
    
    return { sessionCookie, expiresIn };
  } catch (error) {
    logger.error(context, 'Error creando session cookie', error);
    throw error;
  }
}

// ================================================================
// 🔐 MIDDLEWARE DE AUTENTICACIÓN CON SOPORTE PARA SESSION COOKIE
// ================================================================

async function verifyFirebaseAuth(req, res, next) {
  const context = 'AUTH_MIDDLEWARE';

  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    req.path === route || req.path.startsWith(route)
  );

  const isPublicApiRoute = PUBLIC_API_ROUTES.some(route =>
    req.path.startsWith(route)
  );

  const isStaticFile = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|map)$/i.test(req.path);

  if (isPublicRoute || isPublicApiRoute || isStaticFile) {
    logger.info(context, 'Ruta pública o excluida', { path: req.path });
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    const cookies = req.headers.cookie;
    let idToken;
    let sessionCookie;

    // Buscar token en diferentes lugares
    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.split('Bearer ')[1];
      logger.info(context, 'Token obtenido de header Authorization');
    } else if (cookies) {
      const cookiesArray = cookies.split(';');
      
      // Buscar session cookie primero (más seguro)
      const sessionCookieValue = cookiesArray.find(cookie => cookie.trim().startsWith('__session='));
      if (sessionCookieValue) {
        sessionCookie = sessionCookieValue.split('=')[1].trim();
        logger.info(context, 'Session cookie encontrada');
        
        // Verificar la session cookie
        const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
        req.user = decodedClaims;
        req.uid = decodedClaims.uid;
        
        logger.info(context, 'Usuario autenticado con session cookie', {
          uid: req.uid,
          email: decodedClaims.email,
          path: req.path
        });
        
        return next();
      }
      
      // Si no hay session cookie, buscar token de ID
      const idTokenCookie = cookiesArray.find(cookie => cookie.trim().startsWith('__idToken='));
      if (idTokenCookie) {
        idToken = idTokenCookie.split('=')[1].trim();
        logger.info(context, 'Token obtenido de cookie __idToken');
      }
    }

    if (!idToken && !sessionCookie) {
      logger.info(context, 'Token no encontrado, redirigiendo a login', {
        path: req.path,
        originalUrl: req.originalUrl
      });

      const returnTo = encodeURIComponent(req.originalUrl);
      return res.redirect(`/login?returnTo=${returnTo}`);
    }

    // Si tenemos idToken, verificarlo
    if (idToken) {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
      req.uid = decodedToken.uid;
      
      // Opcionalmente, convertir a session cookie para futuras requests
      try {
        const { sessionCookie: newSessionCookie, expiresIn } = await createSessionCookie(idToken);
        
        // Configurar cookie segura
        res.cookie('__session', newSessionCookie, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: expiresIn,
          path: '/'
        });
        
        logger.info(context, 'Session cookie creada y almacenada');
      } catch (cookieError) {
        logger.warn(context, 'No se pudo crear session cookie', cookieError);
        // Continuar de todas formas, el idToken es válido
      }
      
      logger.info(context, 'Usuario autenticado con idToken', {
        uid: req.uid,
        email: decodedToken.email,
        path: req.path
      });
    }

    next();
  } catch (error) {
    logger.error(context, 'Error de autenticación', error, {
      path: req.path
    });

    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${returnTo}`);
  }
}

// ================================================================
// 🚨 RUTAS DE API PÚBLICAS (PRIMERO - ANTES DEL MIDDLEWARE)
// ================================================================

// ✅ NUEVO ENDPOINT: Reportar intento fallido desde el frontend
app.post("/api/report-failed-login", async (req, res) => {
  const context = 'REPORT_FAILED_LOGIN_API';

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    logger.info(context, '🚨 Intento fallido reportado desde frontend', { email });

    // Registrar el intento fallido
    await registerFailedLogin(email, req);

    // Verificar estado actual después del registro
    const blockStatus = await checkLoginBlock(email);

    res.json({
      success: true,
      currentAttempts: blockStatus.attempts || 0,
      maxAttempts: MAX_LOGIN_ATTEMPTS,
      isBlocked: blockStatus.isBlocked || false,
      blockedUntil: blockStatus.blockedUntil || null,
      remainingMinutes: blockStatus.remainingMinutes || null
    });

  } catch (error) {
    logger.error(context, 'Error procesando reporte de login fallido', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ✅ NUEVO ENDPOINT: Login exitoso (resetea intentos y crea session cookie)
app.post("/api/login-success", async (req, res) => {
  const context = 'LOGIN_SUCCESS_API';

  try {
    const { email, uid, displayName, isNewUser, idToken } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    logger.info(context, '✅ Login exitoso reportado desde frontend, reseteando intentos', { email, isNewUser });

    // Resetear los intentos fallidos
    await resetLoginAttempts(email);

    // Si se proporcionó un idToken, crear session cookie
    if (idToken && admin.apps.length) {
      try {
        const { sessionCookie, expiresIn } = await createSessionCookie(idToken);
        
        // Configurar cookie segura
        res.cookie('__session', sessionCookie, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: expiresIn,
          path: '/'
        });
        
        logger.info(context, 'Session cookie creada y almacenada para usuario', { email });
      } catch (cookieError) {
        logger.warn(context, 'No se pudo crear session cookie', cookieError);
        // Continuar de todas formas
      }
    }

    // Si es un nuevo usuario (ej. registro con Google), enviar correo de bienvenida y asignar créditos
    if (isNewUser && uid) {
      logger.info(context, '🆕 Nuevo usuario detectado (Google Auth), procesando bienvenida', { email, uid });
      
      const nombre = displayName || email.split('@')[0];
      const welcomeResult = await enviarBienvenida(email, nombre);
      
      if (db) {
        const userRef = db.collection("usuarios").doc(uid);
        const userDoc = await userRef.get();
        
        const updateData = {
          lastLogin: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!userDoc.exists || userDoc.data().creditos === undefined) {
          updateData.creditos = 0;
          updateData.tipoPlan = "creditos";
          logger.info(context, '💰 Créditos inicializados para nuevo usuario', { email });
        }

        if (welcomeResult.success) {
          updateData.welcomeEmailSent = true;
          updateData.welcomeEmailSentAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await userRef.set(updateData, { merge: true });
      }
    }

    // SEGURIDAD: Guardar datos de sesión en cookies seguras (HttpOnly y Secure)
    const cookieOptions = {
      httpOnly: true, // Protegido contra XSS
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
      path: '/'
    };

    res.cookie('user_email', email, cookieOptions);
    res.cookie('user_uid', uid, cookieOptions);

    res.json({
      success: true,
      message: 'Login attempts reset successfully and session cookies set',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(context, 'Error procesando login exitoso', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Endpoint de notificación de verificación
app.post("/api/notify-verification", async (req, res) => {
  const context = 'NOTIFY_VERIFICATION';
  
  try {
    const { uid, email, displayName } = req.body;

    if (!uid || !email) {
      logger.error(context, 'Datos incompletos en notificación', null, req.body);
      return res.status(400).json({
        success: false,
        error: 'Se requiere uid y email'
      });
    }

    logger.info(context, '📧 Verificación confirmada, enviando correo de bienvenida', {
      uid, email, displayName
    });

    const result = await enviarBienvenida(email, displayName || email.split('@')[0]);

    if (result.success) {
      if (db) {
        await db.collection("usuarios").doc(uid).set({
          creditos: admin.firestore.FieldValue.increment(0), // Asegura que el campo exista sin sobreescribir si ya tiene
          welcomeEmailSent: true,
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Inicializar créditos si el documento es nuevo o no tiene el campo
        const userDoc = await db.collection("usuarios").doc(uid).get();
        if (!userDoc.exists || userDoc.data().creditos === undefined) {
          await db.collection("usuarios").doc(uid).set({
            creditos: 0, // O el valor por defecto que desees, ej: 5
            tipoPlan: "creditos"
          }, { merge: true });
        }
      }

      res.json({
        success: true,
        message: 'Correo de bienvenida enviado correctamente'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'No se pudo enviar el correo de bienvenida',
        details: result.error
      });
    }

  } catch (error) {
    logger.error(context, 'Error procesando notificación de verificación', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint de análisis con Gemini
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

// Endpoint de configuración - MODIFICADO: Solo variables de cliente
app.get("/api/config", (req, res) => {
  logger.info('API_CONFIG', 'Solicitud de configuración recibida');

  // SOLO variables de cliente de Firebase, NO credenciales de Admin SDK
  const firebaseClientConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  };

  res.json({
    mercadopagoPublicKey: process.env.MERCADOPAGO_PUBLIC_KEY,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    firebaseConfig: firebaseClientConfig,
    environment: process.env.NODE_ENV || 'production',
    peliprexBaseUrl: process.env.PELIPREX_BASE_URL,
    timestamp: new Date().toISOString()
  });
});

// Endpoint de validación de reCAPTCHA - ACTUALIZADO PARA USAR LA FUNCIÓN MEJORADA
app.post("/api/validate-recaptcha", async (req, res) => {
  const context = 'RECAPTCHA_API';

  try {
    const { recaptchaResponse } = req.body;

    if (!recaptchaResponse) {
      return res.status(400).json({
        success: false,
        error: 'reCAPTCHA response is required'
      });
    }

    const validationResult = await validateRecaptcha(recaptchaResponse);

    logger.info(context, 'reCAPTCHA validado exitosamente');

    res.json({
      success: true,
      message: 'reCAPTCHA validation successful',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(context, 'Error en validación reCAPTCHA', error);

    res.status(400).json({
      success: false,
      error: error.message || 'reCAPTCHA validation failed',
      timestamp: new Date().toISOString()
    });
  }
});

// ================================================================
// 🔐 ENDPOINT DE LOGIN CON SISTEMA DE BLOQUEO (MODIFICADO)
// ================================================================

app.post("/api/login", async (req, res) => {
  const context = 'LOGIN_API';

  try {
    const { email, recaptchaResponse, returnTo, deviceId, deviceModel } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required'
      });
    }

    // ✅ 1. VERIFICAR SI EL USUARIO ESTÁ BLOQUEADO
    const blockStatus = await checkLoginBlock(email);

    if (blockStatus.isBlocked) {
      const hoursRemaining = Math.ceil(blockStatus.remainingMinutes / 60);
      
      logger.warn(context, '🚫 Intento de login bloqueado', {
        email,
        attempts: blockStatus.attempts,
        blockedUntil: blockStatus.blockedUntil?.toISOString(),
        remainingMinutes: blockStatus.remainingMinutes
      });

      return res.status(403).json({
        success: false,
        error: 'account_blocked',
        message: `Cuenta bloqueada por seguridad. Intenta nuevamente en ${hoursRemaining} hora(s).`,
        blockedUntil: blockStatus.blockedUntil,
        attempts: blockStatus.attempts,
        maxAttempts: MAX_LOGIN_ATTEMPTS
      });
    }

    // ✅ 2. VALIDACIÓN DE COHERENCIA Y FINGERPRINT
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const isCoherent = validateDeviceCoherence(deviceModel, userAgent);
    const currentFingerprint = generateFingerprint(req);
    const currentIp = getClientIp(req);

    if (!isCoherent) {
      logger.warn(context, '🚨 Incoherencia de dispositivo detectada', { email, deviceModel, userAgent });
      await sendSuspiciousLoginEmail(email, currentIp, userAgent, deviceModel, true);
      return res.status(403).json({
        success: false,
        error: 'suspicious_attempt',
        message: 'Actividad sospechosa detectada. Se ha enviado una alerta a tu correo.'
      });
    }

    // ✅ 3. VALIDAR RECAPTCHA
    await validateRecaptcha(recaptchaResponse);

    logger.info(context, 'Login validado con reCAPTCHA', { email, returnTo, currentAttempts: blockStatus.attempts || 0 });

    // ✅ 4. ACTUALIZAR INFORMACIÓN DE DISPOSITIVO
    if (db) {
      const userSnap = await db.collection("usuarios")
        .where("email", "==", email)
        .limit(1)
        .get();

      if (!userSnap.empty) {
        const userDoc = userSnap.docs[0];
        const userRef = userDoc.ref;
        const userData = userDoc.data() || {};

        // Alerta si el dispositivo o fingerprint cambian
        const isNewDevice = userData.lastDeviceId && userData.lastDeviceId !== deviceId;
        const isNewFingerprint = userData.lastFingerprint && userData.lastFingerprint !== currentFingerprint;

        if (isNewDevice || isNewFingerprint) {
          await sendSuspiciousLoginEmail(email, currentIp, userAgent, deviceModel, false);
        }

        await userRef.set({
          lastDeviceId: deviceId,
          lastDeviceModel: deviceModel || 'Unknown',
          lastFingerprint: currentFingerprint,
          lastIp: currentIp,
          lastLogin: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    const redirectPath = returnTo && returnTo !== 'undefined' && returnTo !== 'null' ? returnTo : '/actividad';

    logger.info(context, 'Login validado exitosamente, esperando autenticación real del frontend', { email, redirectPath });

    // ✅ NOTA: NO se resetean los intentos aquí
    // Los intentos se resetearán en /api/login-success cuando el login real sea exitoso

    res.json({
      success: true,
      message: 'Login validation successful (reCAPTCHA validated)',
      redirectTo: redirectPath,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(context, 'Error en login', error);

    res.status(400).json({
      success: false,
      error: error.message || 'Login validation failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint de registro
app.post("/api/register", async (req, res) => {
  const context = 'REGISTER_API';

  try {
    const { name, email, password, recaptchaResponse, returnTo, deviceId } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required'
      });
    }

    await validateRecaptcha(recaptchaResponse);

    logger.info(context, 'Registro iniciado con reCAPTCHA validado', { email, name, returnTo });

    if (db) {
      const existingSnap = await db.collection("usuarios")
        .where("deviceId", "==", deviceId)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        const existingData = existingSnap.docs[0].data() || {};
        const existingEmail = (existingData.email || "").toLowerCase();
        const requestedEmail = email.toLowerCase();

        if (existingEmail && existingEmail !== requestedEmail) {
          const currentIp = getClientIp(req);

          await resend.emails.send({
            from: 'Seguridad Masitaprex <no-reply@masitaprex.com>',
            to: email,
            subject: 'Registro rechazado',
            template_id: '6767bd1b-6b6a-4488-bed7-ad185513d763',
            params: {
              ip: currentIp,
              timestamp: new Date().toISOString()
            }
          });

          return res.status(409).json({
            success: false,
            error: 'Registro bloqueado: deviceId ya existe con otro correo'
          });
        }
      }
    }

    const redirectPath = returnTo && returnTo !== 'undefined' && returnTo !== 'null' ? returnTo : '/actividad';

    logger.info(context, 'Registro exitoso, redirigiendo a verify con returnTo', { email, redirectPath });

    res.json({
      success: true,
      message: 'Registration successful (reCAPTCHA validated)',
      redirectTo: `/verify?returnTo=${encodeURIComponent(redirectPath)}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(context, 'Error en registro', error);

    res.status(400).json({
      success: false,
      error: error.message || 'Registration failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint de pago
app.post("/api/pay", async (req, res) => {
  const context = 'PAYMENT_PROCESS';
  const startTime = Date.now();

  if (!mpClient) {
    logger.error(context, 'Mercado Pago no configurado');
    return res.status(503).json({
      error: 'Servicio de pagos no disponible',
      message: 'Por favor, contacte al administrador del sistema'
    });
  }

  try {
    const {
      token, amount, email, uid, description, installments,
      payment_method_id, issuer_id, identificationType, identificationNumber
    } = req.body;

    logger.info(context, 'Procesando pago', {
      uid, email, amount, payment_method_id, installments
    });

    if (!token || !amount || !uid) {
      logger.error(context, 'Datos de pago incompletos', null, req.body);
      return res.status(400).json({
        error: 'Datos incompletos',
        required: ['token', 'amount', 'uid']
      });
    }

    const payment = new Payment(mpClient);

    const paymentData = {
      body: {
        transaction_amount: Number(amount),
        token,
        description: description || 'Créditos Consulta PE',
        installments: Number(installments) || 1,
        payment_method_id,
        issuer_id: issuer_id ? Number(issuer_id) : undefined,
        payer: {
          email: email,
          identification: {
            type: identificationType || 'DNI',
            number: identificationNumber
          }
        },
        notification_url: `${HOST_URL}/api/webhook/mercadopago`,
        metadata: {
          uid: uid,
          email: email,
          amount: amount,
          timestamp: new Date().toISOString(),
          source: 'direct_payment'
        }
      }
    };

    logger.info(context, 'Creando pago en Mercado Pago', { metadata: paymentData.body.metadata });

    const result = await payment.create(paymentData);
    const processingTime = Date.now() - startTime;

    logger.info(context, 'Respuesta de Mercado Pago recibida', {
      paymentId: result.id,
      status: result.status,
      processingTime: `${processingTime}ms`
    });

    if (result.status === 'approved') {
      logger.info(context, '💳 Pago aprobado instantáneamente, otorgando beneficios', {
        paymentId: result.id,
        uid
      });

      const beneficioResult = await otorgarBeneficio(
        uid,
        email,
        Number(amount),
        'MP_CARD_INSTANT',
        result.id.toString()
      );

      logger.info(context, 'Resultado de otorgar beneficio', beneficioResult);

      result.beneficioOtorgado = beneficioResult.status === 'success' || beneficioResult.status === 'already_processed';
      result.beneficioStatus = beneficioResult.status;

      if (beneficioResult.creditosOtorgados !== undefined) {
        result.creditosOtorgados = beneficioResult.creditosOtorgados;
        result.creditosNuevos = beneficioResult.creditosNuevos;
        result.creditosAnteriores = beneficioResult.creditosAnteriores;
      }
      if (beneficioResult.planOtorgado) {
        result.planOtorgado = beneficioResult.planOtorgado;
      }
      if (beneficioResult.pdfUrl) {
        result.pdfUrl = beneficioResult.pdfUrl;
      }
      result.tipoPlanNuevo = beneficioResult.tipoPlanNuevo;
    } else {
      logger.info(context, '⏳ Pago no aprobado instantáneamente, esperando webhook', {
        paymentId: result.id,
        status: result.status,
        statusDetail: result.status_detail
      });
    }

    res.json(result);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error(context, 'Error procesando pago', error, {
      processingTime: `${processingTime}ms`,
      requestBody: req.body
    });

    let errorMessage = 'Error procesando el pago';
    let errorDetails = {};

    if (error.api_response?.body) {
      errorDetails = error.api_response.body;
      errorMessage = errorDetails.message || errorMessage;

      if (errorDetails.cause) {
        logger.error(context, 'Error específico de Mercado Pago', null, {
          cause: errorDetails.cause,
          code: errorDetails.error,
          status: errorDetails.status
        });
      }
    }

    res.status(400).json({
      error: errorMessage,
      details: errorDetails,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Webhook de Mercado Pago
app.post("/api/webhook/mercadopago", async (req, res) => {
  const context = 'WEBHOOK_MP';
  const webhookData = req.body;

  logger.info(context, '📩 Webhook recibido', {
    action: webhookData.action,
    type: webhookData.type,
    id: webhookData.data?.id,
    receivedAt: new Date().toISOString()
  });

  res.sendStatus(200);

  if (!mpClient) {
    logger.error(context, 'Mercado Pago no configurado, ignorando webhook');
    return;
  }

  const isPaymentEvent = webhookData.action?.includes('payment') || webhookData.type === 'payment';

  if (isPaymentEvent) {
    try {
      const paymentId = webhookData.data?.id || webhookData.id;

      if (!paymentId) {
        logger.error(context, 'Payment ID no encontrado en webhook', null, webhookData);
        return;
      }

      logger.info(context, '🔍 Consultando información del pago', { paymentId });

      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      logger.info(context, '📄 Información del pago obtenida', {
        paymentId,
        status: paymentInfo.status,
        statusDetail: paymentInfo.status_detail
      });

      if (paymentInfo.status === "approved") {
        const metadata = paymentInfo.metadata || {};
        const uid = metadata.uid;
        const email = metadata.email || paymentInfo.payer?.email;
        const amount = metadata.amount || paymentInfo.transaction_amount;

        if (uid) {
          logger.info(context, '✅ Procesando pago aprobado via webhook', {
            paymentId, uid, email, amount
          });

          const beneficioResult = await otorgarBeneficio(
            uid,
            email,
            Number(amount),
            'MP_WEBHOOK',
            paymentId.toString()
          );

          logger.info(context, '📊 Resultado del webhook', {
            paymentId,
            uid,
            beneficioStatus: beneficioResult.status,
            message: beneficioResult.message || 'Procesado correctamente',
            wasAlreadyProcessed: beneficioResult.status === 'already_processed',
            pdfUrl: beneficioResult.pdfUrl || null
          });

        } else {
          logger.error(context, '❌ UID no encontrado en metadatos del pago', null, {
            paymentId,
            metadata,
            payer: paymentInfo.payer
          });
        }
      } else {
        logger.info(context, '⏸️ Pago no está aprobado, ignorando', {
          paymentId,
          status: paymentInfo.status
        });
      }

    } catch (error) {
      logger.error(context, '❌ Error procesando webhook', error, {
        paymentId: webhookData.data?.id,
        action: webhookData.action
      });
    }
  } else {
    logger.info(context, '⏹️ Evento no relevante ignorado', {
      action: webhookData.action,
      type: webhookData.type
    });
  }
});

// Endpoint para obtener información del pago
app.get("/api/payment/:paymentId", async (req, res) => {
  const context = 'GET_PAYMENT_INFO';
  const { paymentId } = req.params;

  try {
    logger.info(context, 'Obteniendo información del pago', { paymentId });

    if (!db) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const pagoDoc = await db.collection("pagos_registrados").doc(paymentId).get();

    if (!pagoDoc.exists) {
      logger.warn(context, 'Pago no encontrado', { paymentId });
      return res.status(404).json({ error: 'Payment not found' });
    }

    const pagoData = pagoDoc.data();

    const fechaRegistro = pagoData.fechaRegistro?.toDate() || new Date();

    res.json({
      id: paymentId,
      email: pagoData.email,
      monto: pagoData.monto,
      creditos: pagoData.creditosOtorgados || 0,
      descripcion: pagoData.descripcion,
      fecha: fechaRegistro.toLocaleDateString('es-PE'),
      hora: fechaRegistro.toLocaleTimeString('es-PE'),
      estado: pagoData.estado,
      tipoPlan: pagoData.tipoPlanNuevo || 'creditos',
      procesado: pagoData.procesado,
      pdfUrl: pagoData.pdfUrl || null,
      storagePath: pagoData.storagePath || null
    });

  } catch (error) {
    logger.error(context, 'Error obteniendo información del pago', error, { paymentId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint para generar factura
app.post("/api/generate-invoice", async (req, res) => {
  const context = 'GENERATE_INVOICE';

  try {
    const {
      paymentId,
      email,
      amount,
      credits,
      description,
      clientName,
      type = 'boleta'
    } = req.body;

    if (!paymentId) {
      logger.error(context, 'Payment ID requerido', null, req.body);
      return res.status(400).json({ error: 'Payment ID es requerido' });
    }

    logger.info(context, 'Solicitud para generar boleta electrónica', { paymentId });

    let existingPdfUrl = null;
    let responseSent = false;

    if (db) {
      try {
        const doc = await db.collection("pagos_registrados").doc(String(paymentId)).get();
        if (doc.exists) {
          const pagoData = doc.data();

          if (pagoData.pdfUrl) {
            existingPdfUrl = pagoData.pdfUrl;
            logger.info(context, '✅ PDF ya existe en datos del pago', {
              paymentId,
              pdfUrl: existingPdfUrl,
              storagePath: pagoData.storagePath || 'N/A'
            });

            res.json({
              success: true,
              pdfUrl: existingPdfUrl,
              downloadUrl: existingPdfUrl,
              storageUrl: existingPdfUrl,
              message: 'Comprobante ya generado previamente',
              existed: true,
              cached: true
            });

            responseSent = true;
            return;
          }
        }
      } catch (dbError) {
        logger.error(context, 'Error consultando Firestore', dbError, { paymentId });
      }
    }

    if (responseSent) return;

    const fileName = `invoices/${paymentId}.pdf`;
    const storageCheck = await checkFileExistsInStorage(fileName);

    if (storageCheck.exists && storageCheck.url) {
      logger.info(context, '✅ PDF ya existe en Storage', {
        paymentId,
        url: storageCheck.url
      });

      if (db) {
        await db.collection("pagos_registrados").doc(String(paymentId)).set({
          pdfUrl: storageCheck.url,
          storagePath: fileName,
          pdfActualizadoEn: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      res.json({
        success: true,
        pdfUrl: storageCheck.url,
        downloadUrl: storageCheck.url,
        storageUrl: storageCheck.url,
        message: 'Comprobante recuperado de Storage exitosamente',
        existed: true,
        fromStorage: true
      });

      return;
    }

    logger.info(context, '📄 Generando nuevo comprobante', { paymentId });

    const invoiceData = {
      orderId: String(paymentId),
      date: new Date().toLocaleString('es-PE'),
      email: email || 'cliente@example.com',
      amount: amount || 10,
      credits: credits || 60,
      description: description || 'Créditos Consulta PE',
      clientName: clientName || '',
      type: 'boleta'
    };

    const pdfPath = await generateInvoicePDF(invoiceData);
    const localPdfPath = path.join(__dirname, 'public', pdfPath);

    let storageUrl = null;
    try {
      storageUrl = await uploadPDFToStorage(localPdfPath, paymentId);

      if (db) {
        await db.collection("pagos_registrados").doc(String(paymentId)).set({
          pdfUrl: storageUrl,
          storagePath: fileName,
          pdfGeneradoEn: admin.firestore.FieldValue.serverTimestamp(),
          tipoComprobante: 'boleta'
        }, { merge: true });
      }

      logger.info(context, '✅ PDF generado y almacenado en Storage', {
        paymentId,
        storageUrl,
        localPath: pdfPath
      });

      if (fs.existsSync(localPdfPath)) {
        fs.unlinkSync(localPdfPath);
      }
    } catch (uploadError) {
      logger.error(context, 'Error subiendo PDF a Storage', uploadError);
      storageUrl = `${HOST_URL}${pdfPath}`;
    }

    logger.info(context, 'Comprobante generado exitosamente', {
      paymentId,
      pdfUrl: storageUrl,
      type
    });

    res.json({
      success: true,
      pdfUrl: storageUrl,
      downloadUrl: storageUrl,
      storageUrl: storageUrl,
      message: 'Comprobante generado exitosamente',
      existed: false,
      generated: true
    });

  } catch (error) {
    logger.error(context, '❌ Error generando comprobante', error, req.body);
    res.status(500).json({
      success: false,
      error: 'Error generando comprobante',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Endpoint para opciones de facturación
app.get("/api/invoice-options", (req, res) => {
  logger.info('INVOICE_OPTIONS', 'Solicitud de opciones de facturación');
  res.json({
    options: [
      { value: 'boleta', label: 'Boleta de Venta', description: 'Para personas naturales' },
      { value: 'factura', label: 'Factura', description: 'Para empresas con RUC' }
    ],
    default: 'boleta'
  });
});

// Health check
app.get("/api/health", async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      mercadopago: !!MERCADOPAGO_ACCESS_TOKEN,
      firebase: !!db,
      firebaseStorage: !!bucket,
      firebaseInitialized: !!admin.apps.length,
      recaptcha: !!RECAPTCHA_SECRET_KEY,
      pdfGenerator: true,
      resend: !!resend,
      loginBlockSystem: true
    },
    environment: process.env.NODE_ENV || 'development',
    hostUrl: HOST_URL,
    flyAppName: process.env.FLY_APP_NAME,
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    processedPaymentsCacheSize: processedPaymentsCache.size,
    activePaymentLocks: paymentLocks.size,
    loginAttemptsCacheSize: loginAttemptsCache.size,
    security: {
      recaptchaSiteKey: RECAPTCHA_SITE_KEY,
      authMiddleware: true,
      publicRoutes: PUBLIC_ROUTES,
      protectedRoutes: PROTECTED_ROUTES,
      publicApiRoutes: PUBLIC_API_ROUTES,
      loginBlockEnabled: true,
      maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
      blockDurationHours: BLOCK_DURATION_HOURS,
      suspiciousLoginEmailEnabled: '📧 Correo automático con plantilla HTML',
      reportFailedLoginEndpoint: '✅ /api/report-failed-login implementado',
      loginSuccessEndpoint: '✅ /api/login-success implementado (resetea intentos)',
      serverSideProtection: '✅ Protección de rutas desde servidor (api-key.html, checkout.html, consultaPe-vercion-web.html)',
      cors: '✅ Configurado solo para dominios específicos',
      corsDomains: allowedOrigins,
      cspEnabled: '✅ CSP activo con dominios específicos',
      sessionCookies: '✅ Implementado con Firebase Session Cookies',
      loginBlockStorage: '✅ Caché en memoria (más económico que Firestore)'
    },
    cspDomainsCount: cspDomains.length
  };

  if (db) {
    try {
      await db.collection('_healthcheck').doc('ping').set({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'ok'
      }, { merge: true });

      health.services.firestore = 'connected';
    } catch (error) {
      health.services.firestore = 'error';
      health.services.firestoreError = error.message;
      health.status = 'degraded';
    }
  }

  logger.info('HEALTH_CHECK', 'Health check solicitado', health);
  res.json(health);
});

// Debug Firebase
app.get("/api/debug/firebase", (req, res) => {
  const firebaseVars = {
    FIREBASE_TYPE: process.env.FIREBASE_TYPE ? '✓' : '✗',
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ? '✓' : '✗',
    FIREBASE_PRIVATE_KEY_ID: process.env.FIREBASE_PRIVATE_KEY_ID ? '✓' : '✗',
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? '✓ (length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : '✗',
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ? '✓' : '✗',
    FIREBASE_CLIENT_ID: process.env.FIREBASE_CLIENT_ID ? '✓' : '✗',
    FIREBASE_CLIENT_X509_CERT_URL: process.env.FIREBASE_CLIENT_X509_CERT_URL ? '✓' : '✗',
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET ? '✓' : '✗'
  };

  const missingVars = Object.entries(firebaseVars)
    .filter(([key, value]) => value === '✗')
    .map(([key]) => key);

  res.json({
    firebaseVars,
    missingVars,
    adminInitialized: !!admin.apps.length,
    firestoreAvailable: !!db,
    storageAvailable: !!bucket,
    loginAttemptsCacheSize: loginAttemptsCache.size,
    timestamp: new Date().toISOString()
  });
});

// Limpiar cache (incluyendo loginAttemptsCache)
app.post("/api/admin/clear-cache", (req, res) => {
  const context = 'ADMIN_CLEAR_CACHE';

  try {
    const paymentsCacheSize = processedPaymentsCache.size;
    const locksSize = paymentLocks.size;
    const loginAttemptsSize = loginAttemptsCache.size;

    processedPaymentsCache.clear();
    paymentLocks.clear();
    loginAttemptsCache.clear();

    logger.info(context, '🗑️ Cache limpiado manualmente', {
      paymentsRemoved: paymentsCacheSize,
      locksRemoved: locksSize,
      loginAttemptsRemoved: loginAttemptsSize
    });

    res.json({
      success: true,
      message: 'Cache cleared successfully',
      paymentsRemoved: paymentsCacheSize,
      locksRemoved: locksSize,
      loginAttemptsRemoved: loginAttemptsSize
    });
  } catch (error) {
    logger.error(context, 'Error limpiando cache', error);
    res.status(500).json({ error: 'Error clearing cache' });
  }
});

// ================================================================
// 🚨 RUTAS ESPECÍFICAS (SEGUNDO)
// ================================================================

app.get("/disclaimer-apis", (req, res) => {
  res.type("html");
  res.sendFile(path.join(__dirname, "public", "disclaimer-apis.html"));
});

app.get("/API-Docs", (req, res) => {
  res.type("html");
  res.sendFile(path.join(__dirname, "public", "API-Docs.html"));
});

// ================================================================
// 🗺️ MAPEO DE RUTAS (TERCERO)
// ================================================================

app.use((req, res, next) => {
  const pathName = req.path;

  const routeMap = {
    '/user/activity': 'actividad.html',
    '/actividad': 'actividad.html',
    '/peliculas': 'PeliPREX.html',
    '/favoritos': 'favoritos.html',
    '/historial': 'historial.html'
  };

  if (routeMap[pathName]) {
    const filePath = path.join(__dirname, 'public', routeMap[pathName]);
    if (fs.existsSync(filePath)) {
      logger.info('ROUTE_MAPPING', `✅ Ruta mapeada: ${pathName} -> ${routeMap[pathName]}`);
      return res.sendFile(filePath);
    }
  }

  next();
});

// ================================================================
// 🧹 CLEAN URLs (CUARTO)
// ================================================================

app.use((req, res, next) => {
  const pathName = req.path;

  const isHtmlRoute = !pathName.includes('.') && 
    !pathName.startsWith('/api/') && 
    pathName !== '/';

  if (isHtmlRoute) {
    const cleanPath = pathName.replace(/^\//, '');
    const htmlPath = path.join(__dirname, 'public', `${cleanPath}.html`);
    
    if (fs.existsSync(htmlPath)) {
      logger.info('CLEAN_URL', 'Sirviendo archivo HTML', {
        path: pathName,
        htmlFile: `${cleanPath}.html`
      });
      return res.sendFile(htmlPath);
    }
  }

  next();
});

// ================================================================
// 📁 ARCHIVOS ESTÁTICOS (QUINTO)
// ================================================================

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// ================================================================
// 🔐 MIDDLEWARE DE AUTENTICACIÓN (SEXTO - DESPUÉS DE RUTAS PÚBLICAS Y ARCHIVOS ESTÁTICOS)
// ================================================================

app.use(verifyFirebaseAuth);

// ================================================================
// 🔍 PROXY DE CONSULTAS API (PROTECCIÓN DE API KEY)
// ================================================================

app.post("/api/proxy-consulta", async (req, res) => {
  const context = 'PROXY_CONSULTA';
  
  try {
    const { endpoint, data } = req.body;
    const uid = req.uid;

    if (!endpoint) {
      return res.status(400).json({ success: false, error: 'Endpoint no proporcionado' });
    }

    if (!uid) {
      return res.status(401).json({ success: false, error: 'Usuario no autenticado' });
    }

    // Obtener la API Key del usuario desde Firestore
    const userDoc = await db.collection("usuarios").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    const apiKey = userDoc.data().apiKey;
    if (!apiKey) {
      return res.status(403).json({ success: false, error: 'API Key no configurada para este usuario' });
    }

    const baseUrl = 'https://api.masitaprex.com/v3';
    const url = `${baseUrl}/${endpoint}`;

    logger.info(context, 'Realizando consulta proxy', { uid, endpoint, data });

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      timeout: 15000 // 15 segundos de timeout
    });

    logger.info(context, 'Respuesta de API recibida', { 
      endpoint, 
      status: response.status, 
      data: response.data 
    });

    res.json(response.data);

  } catch (error) {
    logger.error(context, 'Error en consulta proxy', error);
    
    if (error.response) {
      // El servidor respondió con un código de error
      return res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      // La petición se hizo pero no hubo respuesta
      return res.status(504).json({ success: false, error: 'No se recibió respuesta del servidor de API' });
    } else {
      // Error al configurar la petición
      return res.status(500).json({ success: false, error: 'Error interno al procesar la consulta' });
    }
  }
});

// ================================================================
// 🏠  RUTAS PRINCIPALES
// ================================================================

app.use((req, res, next) => {
  const isStaticFile = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|map)$/i.test(req.path);
  const isApiRoute = req.path.startsWith('/api/');

  if (!isStaticFile && !isApiRoute && req.path !== '/') {
    if (req.path === '/disclaimer-apis' || req.path === '/API-Docs') {
      return next();
    }

    const requestedPath = path.join(__dirname, 'public', req.path);
    const requestedHtmlPath = path.join(__dirname, 'public', `${req.path}.html`);

    const fileExists = fs.existsSync(requestedPath) ||
      fs.existsSync(requestedHtmlPath);

    if (!fileExists) {
      logger.warn('404_REDIRECT', 'Página no encontrada, redirigiendo a error-404', {
        path: req.path,
        originalUrl: req.originalUrl
      });

      const error404Path = path.join(__dirname, 'public', 'error-404.html');
      if (fs.existsSync(error404Path)) {
        return res.status(404).sendFile(error404Path);
      } else {
        return res.status(404).send('404 - Página no encontrada');
      }
    }
  }

  next();
});

app.get("/", (req, res) => {
  logger.info('ROOT_HOME', 'Sirviendo home.html como página principal');
  const homePath = path.join(__dirname, 'public', 'home.html');
  if (fs.existsSync(homePath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(homePath);
  } else {
    res.status(404).send('Home page not found');
  }
});

app.get("/api", (req, res) => {
  res.json({ status: "ok" });
});

// ================================================================
// ⚠️ MANEJO DE ERRORES GLOBAL
// ================================================================

app.use((err, req, res, next) => {
  logger.error('GLOBAL_ERROR', 'Error no manejado', err, {
    path: req.path,
    method: req.method
  });

  res.status(500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Contacte al soporte',
    requestId: Date.now().toString(36)
  });
});

// ================================================================
// 🚀 INICIO DEL SERVIDOR - PUERTO CORREGIDO
// ================================================================

const PORT = process.env.PORT || 80;
app.listen(PORT, "0.0.0.0", () => {
  logger.info('SERVER', `🚀 Servidor iniciado en puerto ${PORT}`, {
    hostUrl: HOST_URL,
    nodeEnv: process.env.NODE_ENV,
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    version: '3.5.0',
    features: {
      authMiddleware: 'Activo (después de rutas públicas)',
      publicRoutes: PUBLIC_ROUTES.length,
      protectedRoutes: PROTECTED_ROUTES.length,
      publicApiRoutes: PUBLIC_API_ROUTES.length,
      custom404: 'Activo (archivo estático)',
      cleanUrls: 'Activo',
      routeMapping: '✅ Implementado',
      autoRedirectToLogin: '✅ Activado',
      returnAfterLogin: '✅ Implementado',
      returnAfterRegister: '✅ Implementado con verify.html',
      returnAfterVerify: '✅ Implementado',
      welcomeEmailOnVerify: '🔥 Plantilla HTML local',
      secureConfig: '✅ /api/config seguro (solo variables cliente)',
      recaptchaVar: '✅ Variable corregida (RECAPTCHA_CLAVE_SECRETA)',
      recaptchaStability: '✅ Mejorada con reintentos automáticos y timeout extendido',
      loginBlockSystem: '🛡️ Sistema de bloqueo por intentos fallidos activado (Caché en memoria)',
      maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
      blockDurationHours: BLOCK_DURATION_HOURS,
      suspiciousLoginEmailEnabled: '📧 Correo automático con plantilla HTML',
      reportFailedLoginEndpoint: '✅ /api/report-failed-login implementado',
      loginSuccessEndpoint: '✅ /api/login-success implementado (resetea intentos)',
      serverSideProtection: '✅ Protección de rutas desde servidor (api-key.html, checkout.html, consultaPe-vercion-web.html)',
      cors: '✅ Configurado solo para dominios específicos',
      corsDomains: allowedOrigins,
      cspEnabled: '✅ CSP activo con dominios específicos',
      cspDomainsCount: cspDomains.length,
      sessionCookies: '✅ Implementado con Firebase Session Cookies',
      loginBlockStorage: '✅ Caché en memoria (más económico que Firestore)'
    },
    timestamp: new Date().toISOString()
  });
});

// ================================================================
// 🚨 MANEJO DE RUTAS NO ENCONTRADAS (ÚLTIMO - DESPUÉS DE TODAS LAS RUTAS)
// ================================================================

app.get("*", (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  const error404Path = path.join(__dirname, 'public', 'error-404.html');
  if (fs.existsSync(error404Path)) {
    res.status(404).sendFile(error404Path);
  } else {
    res.status(404).send('404 - Página no encontrada');
  }
});
