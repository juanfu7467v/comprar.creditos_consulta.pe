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
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ================================================================
// âœ‰ï¸ CONFIGURACIÃ“N DE RESEND (NUEVO)
// ================================================================

const resend = new Resend(process.env.RESEND_API_KEY);

// ================================================================
// âœ‰ï¸ FUNCIONES DE ENVÃO DE CORREO (RESEND)
// ================================================================

async function enviarBienvenida(email, nombre) {
  const context = 'EMAIL_BIENVENIDA';
  try {
    await resend.emails.send({
      from: 'Masitaprex <bienvenida@masitaprex.com>',
      to: email,
      subject: 'Bienvenido a Masitaprex',
      template_id: '9a5bd01c-b50b-4d1e-aa80-98905228b4af',
      variables: {
        nombre: nombre
      }
    });
    logger.info(context, 'Correo de bienvenida enviado', { email });
  } catch (error) {
    logger.error(context, 'Error enviando bienvenida', error, { email });
  }
}

async function alertaLogin(email, nombre) {
  const context = 'EMAIL_ALERTA_LOGIN';
  try {
    await resend.emails.send({
      from: 'Seguridad <seguridad@masitaprex.com>',
      to: email,
      subject: 'Nuevo inicio de sesión',
      template_id: '933e5952-6373-4b2c-8cde-db9e332e444e',
      variables: {
        nombre: nombre
      }
    });
    logger.info(context, 'Alerta de login enviada', { email });
  } catch (error) {
    logger.error(context, 'Error enviando alerta de login', error, { email });
  }
}

async function socioDuplicado(email) {
  const context = 'EMAIL_SOCIO_DUPLICADO';
  try {
    await resend.emails.send({
      from: 'Masitaprex <system@masitaprex.com>',
      to: email,
      subject: 'Registro duplicado detectado',
      template_id: '6767bd1b-6b6a-4488-bed7-ad185513d763'
    });
    logger.info(context, 'Correo de duplicado enviado', { email });
  } catch (error) {
    logger.error(context, 'Error enviando alerta de duplicado', error, { email });
  }
}

// ================================================================
// ðŸŒ HELPERS DE IP (NUEVO)
// ================================================================

function getClientIp(req) {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.length > 0) {
    return xForwardedFor.split(",")[0].trim();
  }
  return req.ip;
}

// ================================================================
// ðŸ” CONFIGURACIÃ“N DE RUTAS Y CONTROL DE ACCESO
// ================================================================

/**
 * Rutas pÃºblicas que NO requieren autenticaciÃ³n
 * Agregar aquÃ­ nuevas pÃ¡ginas pÃºblicas
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
 * Rutas protegidas que requieren autenticaciÃ³n
 * âœ… ACTUALIZADO: Agregadas /user/activity y /peliculas
 */
const PROTECTED_ROUTES = [
  '/favoritos',
  '/favoritos.html',
  '/historial',
  '/historial.html',
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
  '/checkout.html'
];

/**
 * Rutas de API que NO requieren middleware de autenticaciÃ³n
 */
const PUBLIC_API_ROUTES = [
  '/api/auth',
  '/api/login',
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
  '/api/analyze'
];

// ================================================================
// ðŸ“‹ LOGS MEJORADOS
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
// ðŸ”¥ CONFIGURACIÃ“N DE FIREBASE
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
      .then(() => ({ status: 'connected', message: 'ConexiÃ³n a Firestore exitosa' }))
      .catch(error => ({ status: 'error', message: error.message }));

    logger.info('FIRESTORE', 'VerificaciÃ³n de conexiÃ³n', firestoreCheck);

  } catch (error) {
    logger.error('FIREBASE', 'Error crÃ­tico al inicializar Firebase Admin', error, {
      projectId: serviceAccount?.project_id,
      clientEmail: serviceAccount?.client_email
    });

    console.error('CRITICAL: Firebase no pudo inicializarse. Algunas funciones no estarÃ¡n disponibles.');
  }
} else if (admin.apps.length) {
  db = admin.firestore();
  bucket = admin.storage().bucket();
  logger.info('FIREBASE', 'Usando instancia existente de Firebase');
} else {
  logger.error('FIREBASE', 'No se pudo inicializar Firebase - Service account no disponible');
}

// ================================================================
// ðŸ” CONFIGURACIÃ“N DE RECAPTCHA
// ================================================================

const RECAPTCHA_SECRET_KEY = process.env.RECAPCHA_CLAVE_SECRETA;
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

  try {
    logger.info(context, 'Validando reCAPTCHA con Google API');

    const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
    const params = new URLSearchParams();
    params.append('secret', RECAPTCHA_SECRET_KEY);
    params.append('response', recaptchaResponse);

    const response = await axios.post(verificationUrl, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const data = response.data;

    logger.info(context, 'Respuesta de reCAPTCHA recibida', {
      success: data.success,
      score: data.score,
      action: data.action,
      hostname: data.hostname,
      challenge_ts: data.challenge_ts
    });

    if (!data.success) {
      logger.warn(context, 'reCAPTCHA validation failed', {
        errorCodes: data['error-codes'] || []
      });
      throw new Error('reCAPTCHA validation failed: ' + (data['error-codes']?.join(', ') || 'Unknown error'));
    }

    return {
      success: true,
      data: data
    };

  } catch (error) {
    logger.error(context, 'Error validando reCAPTCHA', error);
    throw error;
  }
}

// ================================================================
// ðŸ’³ CONFIGURACIÃ“N DE MERCADO PAGO
// ================================================================

const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const HOST_URL = process.env.HOST_URL || `https://${process.env.FLY_APP_NAME}.fly.dev`;

if (!MERCADOPAGO_ACCESS_TOKEN) {
  logger.error('CONFIG', 'MERCADOPAGO_ACCESS_TOKEN no estÃ¡ configurado');
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
// ðŸ” MIDDLEWARE DE AUTENTICACIÃ“N MEJORADO
// ================================================================

/**
 * Middleware para verificar autenticaciÃ³n Firebase
 * Protege rutas y redirige a login si no estÃ¡ autenticado
 * âœ… MEJORADO: Guarda la URL original para redirigir despuÃ©s del login
 */
async function verifyFirebaseAuth(req, res, next) {
  const context = 'AUTH_MIDDLEWARE';

  // Verificar si la ruta estÃ¡ excluida de autenticaciÃ³n
  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    req.path === route || req.path.startsWith(route)
  );

  const isPublicApiRoute = PUBLIC_API_ROUTES.some(route =>
    req.path.startsWith(route)
  );

  // Archivos estÃ¡ticos excluidos
  const isStaticFile = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|map)$/i.test(req.path);

  if (isPublicRoute || isPublicApiRoute || isStaticFile) {
    logger.info(context, 'Ruta pÃºblica o excluida', { path: req.path });
    return next();
  }

  try {
    // Verificar token de Firebase desde cookie, localStorage o header
    const authHeader = req.headers.authorization;
    const cookies = req.headers.cookie;
    let idToken;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.split('Bearer ')[1];
      logger.info(context, 'Token obtenido de header Authorization');
    } else if (cookies) {
      const cookiesArray = cookies.split(';');
      const sessionCookie = cookiesArray.find(cookie => cookie.trim().startsWith('__session='));
      if (sessionCookie) {
        idToken = sessionCookie.split('=')[1].trim();
        logger.info(context, 'Token obtenido de cookie __session');
      }
    }

    if (!idToken) {
      logger.info(context, 'Token no encontrado, redirigiendo a login', {
        path: req.path,
        originalUrl: req.originalUrl
      });

      // âœ… MEJORA: Redirigir a login con parÃ¡metro returnTo para volver despuÃ©s del login
      const returnTo = encodeURIComponent(req.originalUrl);
      return res.redirect(`/login?returnTo=${returnTo}`);
    }

    // Verificar token con Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    req.uid = decodedToken.uid;

    logger.info(context, 'Usuario autenticado', {
      uid: req.uid,
      email: decodedToken.email,
      path: req.path
    });

    next();
  } catch (error) {
    logger.error(context, 'Error de autenticaciÃ³n', error, {
      path: req.path
    });

    // âœ… MEJORA: Redirigir a login con parÃ¡metro returnTo para volver despuÃ©s del login
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${returnTo}`);
  }
}

// ================================================================
// ðŸ”§ FUNCIONES DE PAGO Y BENEFICIOS
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
  logger.info(context, 'ðŸ”’ Lock adquirido', { paymentRef });
  return true;
}

function releasePaymentLock(paymentRef) {
  const context = 'PAYMENT_LOCK';
  paymentLocks.delete(paymentRef);
  logger.info(context, 'ðŸ”“ Lock liberado', { paymentRef });
}

async function checkFileExistsInStorage(fileName) {
  const context = 'STORAGE_CHECK';

  if (!bucket) {
    logger.error(context, 'Firebase Storage no estÃ¡ inicializado');
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
    logger.error(context, 'Firebase Storage no estÃ¡ inicializado');
    throw new Error('Firebase Storage not initialized');
  }

  try {
    logger.info(context, 'Intentando subir PDF a Firebase Storage', { pdfPath, paymentId });

    const fileName = `invoices/${paymentId}.pdf`;

    const fileCheck = await checkFileExistsInStorage(fileName);
    if (fileCheck.exists && fileCheck.url) {
      logger.info(context, 'ðŸ“Œ PDF ya existe en Storage, devolviendo URL existente', {
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

    logger.info(context, 'âœ… PDF subido exitosamente a Storage', {
      paymentId,
      fileName,
      publicUrl,
      size: fs.statSync(pdfPath).size
    });

    return publicUrl;

  } catch (error) {
    logger.error(context, 'âŒ Error subiendo PDF a Storage', error, { pdfPath, paymentId });
    throw error;
  }
}

async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRef) {
  const context = 'OTORGAR_BENEFICIO';

  if (!db) {
    logger.error(context, 'Firebase DB no estÃ¡ inicializado', null, { uid, paymentRef });
    return { status: 'error', message: 'Database not initialized' };
  }

  if (!uid) {
    logger.error(context, 'UID no proporcionado', null, { paymentRef, montoPagado });
    return { status: 'error', message: 'No UID provided' };
  }

  const paymentRefString = String(paymentRef);

  if (processedPaymentsCache.has(paymentRefString)) {
    const cachedData = processedPaymentsCache.get(paymentRefString);
    logger.warn(context, 'ðŸš« Pago ya procesado en cache de memoria (idempotencia)', {
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
    logger.error(context, 'âŒ No se pudo adquirir lock para procesar pago', null, {
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
        logger.warn(context, 'ðŸš« Pago ya procesado anteriormente en Firestore (idempotencia)', {
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

    logger.info(context, 'âœ… Procesando nuevo pago', {
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

      logger.info(context, 'ðŸ“Š Estado actual del usuario', {
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

        descripcion = `${creditosOtorgados} CrÃ©ditos`;
        logger.info(context, 'ðŸ’³ CrÃ©ditos otorgados', {
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

          logger.info(context, 'âž• Acumulando dÃ­as al plan ilimitado existente', {
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

          logger.info(context, 'ðŸ†• Creando nuevo plan ilimitado', {
            uid,
            diasNuevos,
            fechaInicio: fechaActivacion.toISOString(),
            fechaFin: fechaFinPlan.toISOString(),
            razon: tienePlanIlimitadoActivo ? 'nuevo_plan' : 'plan_vencido_o_inexistente'
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
        descripcion = `Plan Ilimitado (${diasNuevos} dÃ­as${duracionTotalDias > diasNuevos ? ' - Total acumulado: ' + duracionTotalDias + ' dÃ­as' : ''})`;

        logger.info(context, 'âœ¨ Plan ilimitado actualizado exitosamente', {
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
        logger.warn(context, 'âš ï¸ Monto no coincide con ningÃºn paquete', { montoPagado, uid });
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
      logger.info(context, 'ðŸ“„ Generando Boleta ElectrÃ³nica automÃ¡ticamente', { paymentRef: paymentRefString });

      const invoiceData = {
        orderId: paymentRefString,
        date: new Date().toLocaleString('es-PE'),
        email: email || 'cliente@example.com',
        amount: montoPagado,
        credits: result.creditosOtorgados || 0,
        description: result.descripcion || 'CrÃ©ditos Consulta PE',
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

      logger.info(context, 'âœ… Boleta generada y subida a Storage exitosamente', {
        paymentRef: paymentRefString,
        storageUrl
      });

      result.pdfUrl = storageUrl;

    } catch (pdfError) {
      logger.error(context, 'âš ï¸ Error generando/subiendo PDF (no crÃ­tico)', pdfError, {
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
      logger.info(context, 'ðŸ§¹ Pago removido del cache', { paymentRef: paymentRefString });
    }, 2 * 60 * 60 * 1000);

    logger.info(context, 'âœ… TransacciÃ³n completada exitosamente', { uid, result });

    releasePaymentLock(paymentRefString);

    return result;

  } catch (error) {
    logger.error(context, 'âŒ Error en otorgarBeneficio', error, { uid, paymentRef: paymentRefString, montoPagado });

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
// ðŸš¨ SOLUCIÃ“N DEFINITIVA - RUTAS PROBLEMÃTICAS ARRIBA DE TODO
// ================================================================

// 1ï¸âƒ£ Forzar que estas rutas respondan como HTML ANTES de cualquier generador PDF
// Esto debe ir ARRIBA de cualquier otra ruta

app.get("/disclaimer-apis", (req, res) => {
  res.type("html");
  res.sendFile(path.join(__dirname, "public", "disclaimer-apis.html"));
});

app.get("/API-Docs", (req, res) => {
  res.type("html");
  res.sendFile(path.join(__dirname, "public", "API-Docs.html"));
});

// ================================================================
// ðŸŒ MIDDLEWARE DE RUTAS Y ARCHIVOS ESTÃTICOS
// ================================================================

// Servir archivos estÃ¡ticos ANTES de aplicar el middleware de autenticaciÃ³n
app.use(express.static(path.join(__dirname, 'public')));

// ================================================================
// âœ… MAPEO LÃ“GICO DE RUTAS (SOLUCIÃ“N AL 404)
// ================================================================

app.use((req, res, next) => {
  const pathName = req.path;

  // ðŸ—ºï¸ Mapeo explÃ­cito de rutas que no coinciden con el nombre del archivo
  const routeMap = {
    '/user/activity': 'actividad.html',
    '/actividad': 'actividad.html',
    '/peliculas': 'PeliPREX.html'
  };

  // Si la ruta estÃ¡ en el mapeo, servir el archivo correspondiente
  if (routeMap[pathName]) {
    const filePath = path.join(__dirname, 'public', routeMap[pathName]);
    if (fs.existsSync(filePath)) {
      logger.info('ROUTE_MAPPING', `âœ… Ruta mapeada: ${pathName} -> ${routeMap[pathName]}`);
      return res.sendFile(filePath);
    }
  }

  // Fallback para Clean URLs estÃ¡ndar (ej: /login -> login.html)
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

// Crear y guardar la nueva pÃ¡gina de error 404 personalizada
const createNewError404Page = () => {
  const error404HTML = `<!DOCTYPE html>
<html lang="es">
<head>
    <script src="global-consultas.js">
async function secureDownload(url, filename) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || 'archivo';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
    } catch (e) {
        console.error('Download failed', e);
        window.open(url, '_blank');
    }
}
</script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PÃ¡gina No Encontrada - Masitaprex</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { font-family: 'Inter', sans-serif; }
        .app-card {
            scroll-snap-align: start;
            display: flex;
            flex-direction: column;
            height: 520px;
        }
        .image-container {
            flex: 0 0 auto;
            width: 100%;
            height: 180px;
            overflow: hidden;
            border-radius: 1rem 1rem 0 0;
        }
        .content-container {
            flex: 1;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
        }
        .badge {
            position: absolute;
            top: 1rem;
            right: -40px;
            width: 160px;
            text-align: center;
            padding: 0.375rem 0;
            transform: rotate(45deg);
            background: linear-gradient(to right, var(--from-color), var(--to-color));
            color: white;
            font-weight: 800;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            z-index: 10;
        }
        .social-icons a {
            font-size: 1.8rem;
            margin: 0 10px;
            transition: all 0.3s ease;
        }
        .social-icons a:hover {
            transform: scale(1.1);
        }
        .social-icons .fa-facebook-square {
            color: #1877F2;
        }
        .social-icons .fa-youtube-square {
            color: #FF0000;
        }
    </style>
</head>
<body class="bg-white min-h-screen text-gray-800">
    <header class="w-full relative h-[80vh] md:h-[48rem] overflow-hidden">
        <div 
            class="absolute inset-0 bg-cover bg-center" 
            style="background-image: url('https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgFvN-s_wpJUIYTsv5JH1Rs37S7ZXWefZfI-Odk6iBG0cJOtmZ0pzgoDXBLsmidMg-ZvXgxVaffJ1iybh0ws1p3CcWNtH3o_REOqcSeBqGqqYBWOyJS5EWfvE9RRwLxba_txfZM5oE2_2HKtSug1LExyEqIGoxC_h7vIelPv3KQtBb4Dln17k-0WA0Z690J/s1536/1000037253.png');"
        >
        </div>
        <div class="absolute inset-0 flex items-end justify-center pb-12 bg-black/30">
            <a href="home" class="px-8 py-4 text-xl bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition duration-300 shadow-2xl transform hover:scale-105">
                Ir a la PÃ¡gina Principal
            </a>
        </div>
    </header>
    <main class="py-12 px-4 md:px-8">
        <h2 class="text-3xl md:text-4xl font-extrabold text-center mb-8 text-indigo-700">Nuestras Soluciones Destacadas</h2>
        <div class="flex overflow-x-scroll snap-x snap-mandatory space-x-6 pb-6 md:justify-center md:flex-wrap md:space-x-0 md:gap-6">
            
            <div class="app-card w-[85vw] sm:w-80 flex-shrink-0 bg-white shadow-2xl rounded-2xl border-t-4 border-purple-500 transform transition hover:scale-[1.02] relative overflow-hidden">
                <div class="badge" style="--from-color: #dc2626; --to-color: #ef4444;">
                    Plataforma 
                </div>
                <div class="image-container">
                    <img src="https://image.winudf.com/v2/image1/ZGV2X2ltYWdlXzM2ODcwNDYzXzIyNjg1OF8yMDI1MTAzMDE5NTI1MjEzOA/icon.webp?w=280&fakeurl=1&type=.webp" alt="Icono de Consulta Pe" class="w-full h-full object-cover">
                </div>
                <div class="content-container">
                    <h3 class="text-xl font-bold text-purple-600 mb-2">
                        Consulta Pe <span class="text-sm font-normal text-gray-500 block">Consulta RÃ¡pida de Datos PÃºblicos</span>
                    </h3>
                    <p class="text-gray-600 mb-4 text-sm flex-grow">
                        Una herramienta de consulta rÃ¡pida y confiable. ObtÃ©n datos pÃºblicos asociados a DNI y RUC, utilizando en ciertos casos solo tu nombre completo. La visualizaciÃ³n de resultados es clara y utiliza elementos visuales para un mejor entendimiento de la informaciÃ³n.
                    </p>
                    <a href="https://com-masitaorex.uptodown.com/android" class="text-indigo-600 font-bold hover:text-pink-600 flex items-center transition duration-200 mt-4">
                        Instalar aplicaciones apk
                        <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                    </a>
                </div>
            </div>
            
            <div class="app-card w-[85vw] sm:w-80 flex-shrink-0 bg-white shadow-2xl rounded-2xl border-t-4 border-indigo-500 transform transition hover:scale-[1.02] relative overflow-hidden">
                <div class="badge" style="--from-color: #4f46e5; --to-color: #6366f1;">
                    Plataforma
                </div>
                <div class="image-container">
                    <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh3YIrB2BVkYPGxA41eZD5b_ZRtb6P8rQxh35guBZPGVQEtZU0b-AVmFNOwSuxJNvXKYWQXR5fZIeGXSxqbKKcfdGq5a4c40MM4IItcEp9E9vmKXLEDVgRYHu3JProhz5GwbTzDR0xTC171AOMDK4e6RKLsamFSZB2iBZXpSG7awMsRkBMPyMoUB733bPq8/s612/1000038813.jpg" alt="Imagen de PeliPREX HD" class="w-full h-full object-cover">
                </div>
                <div class="content-container">
                    <h3 class="text-xl font-bold text-indigo-600 mb-2">
                        PeliPREX HD <span class="text-sm font-normal text-gray-500 block">Acceso Digital mediante Infraestructura Intermediaria</span>
                    </h3>
                    <p class="text-gray-600 mb-4 text-sm flex-grow">
                        Plataforma basada en infraestructura intermediaria que facilita el acceso organizado a contenidos digitales disponibles en lÃ­nea. Explora, descubre y conÃ©ctate fÃ¡cilmente desde una interfaz rÃ¡pida y moderna.
                    </p>
                    <a href="peliPREX" class="text-indigo-600 font-bold hover:text-pink-600 flex items-center transition duration-200 mt-4">
                        Acceder a PeliPREX
                        <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                    </a>
                </div>
            </div>
            
            <div class="app-card w-[85vw] sm:w-80 flex-shrink-0 bg-white shadow-2xl rounded-2xl border-t-4 border-blue-500 transform transition hover:scale-[1.02] relative overflow-hidden">
                <div class="badge" style="--from-color: #2563eb; --to-color: #60a5fa;">
                    Servicio
                </div>
                <div class="image-container">
                    <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEifNMAy4k9FFdDT96JpFiktrjRpRJz_Quq3lIrHz1t_NdKTZtU6NfMYzmkNGOVtwUg2hdfSZm0lN5SFp5j4LvDZCSd9QUNP8UUS9k_aGvdZ3Tj9W8DhzDFSdTWZJlRHsJ_OraOpFHWtX8wvKVM1oCpj3ggPZKEYMbuGSav51DbbTnZ3dUYSZTnipiJ57nyq/s1408/1000089677.png" alt="Imagen de ConexiÃ³n API" class="w-full h-full object-cover">
                </div>
                <div class="content-container">
                    <h3 class="text-xl font-bold text-blue-600 mb-2">
                        ConexiÃ³n API <span class="text-sm font-normal text-gray-500 block">Infraestructura Intermediaria para APIs</span>
                    </h3>
                    <p class="text-gray-600 mb-4 text-sm flex-grow">
                        Servicio digital basado en infraestructura intermediaria que facilita la conexiÃ³n tÃ©cnica con diversas fuentes de datos mediante APIs, sin almacenar ni modificar la informaciÃ³n consultada.
                    </p>
                    <a href="api-key" class="text-indigo-600 font-bold hover:text-pink-600 flex items-center transition duration-200 mt-4">
                        Gestionar API Key
                        <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                    </a>
                </div>
            </div>
        </div>
    </main>
    <footer class="bg-gray-900 text-gray-400 py-10 px-6">
        <div class="max-w-4xl mx-auto text-center">
            <h3 class="text-xl font-bold text-white mb-6">SÃ­guenos en nuestras redes sociales</h3>
            <div class="social-icons mb-8">
                <a href="https://m.facebook.com/61564349657272/" target="_blank" aria-label="Facebook">
                    <i class="fab fa-facebook-square"></i>
                </a>
                <a href="https://youtube.com/@eltiojota628?si=sZw2ZHHTUMdaR0nL" target="_blank" aria-label="YouTube">
                    <i class="fab fa-youtube-square"></i>
                </a>
            </div>
            <p class="mb-6 text-lg">Consulta PE Â© 2024 - Todos los derechos reservados</p>
            <div class="mb-8 flex flex-wrap justify-center gap-4 text-sm">
                <a href="terminos-condiciones" class="hover:text-indigo-400 transition hover:underline">TÃ©rminos y condiciones</a>
                <span class="text-gray-600">|</span>
                <a href="politica-privacidad" class="hover:text-indigo-400 transition hover:underline">PolÃ­tica de privacidad</a>
                <span class="text-gray-600">|</span>
                <a href="aviso-legal-peliprex" class="hover:text-indigo-400 transition hover:underline">Aviso legal peliPREX</a>
                <span class="text-gray-600">|</span>
                <a href="disclaimer-apis" class="hover:text-indigo-400 transition hover:underline">Aviso legal apis</a>
                <span class="text-gray-600">|</span>
                <a href="disclaimer-apis" class="hover:text-indigo-400 transition hover:underline">Descargo de responsabilidad</a>
            </div>
            <p class="text-sm max-w-3xl mx-auto leading-relaxed">
                Esta aplicaciÃ³n utiliza servicios de intermediaciÃ³n para facilitar el acceso a informaciÃ³n pÃºblica. 
                <strong class="text-white">No somos los propietarios, custodios ni responsables directos de la informaciÃ³n o de las APIs de las entidades de origen.</strong>
            </p>
        </div>
    </footer>
</body>
</html>`;

  const error404Path = path.join(__dirname, 'public', 'error-404.html');
  fs.writeFileSync(error404Path, error404HTML);
  logger.info('ERROR_404', 'Nueva pÃ¡gina de error 404 creada exitosamente', { path: error404Path });
};

// Crear la pÃ¡gina de error 404 al iniciar
createNewError404Page();

// Middleware para detectar pÃ¡ginas inexistentes y redirigir a error-404
app.use((req, res, next) => {
  const isStaticFile = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|map)$/i.test(req.path);
  const isApiRoute = req.path.startsWith('/api/');

  if (!isStaticFile && !isApiRoute && req.path !== '/') {
    // Excluir las rutas problemÃ¡ticas que ya manejamos
    if (req.path === '/disclaimer-apis' || req.path === '/API-Docs') {
      return next();
    }

    const requestedPath = path.join(__dirname, 'public', req.path);
    const requestedHtmlPath = path.join(__dirname, 'public', `${req.path}.html`);

    const fileExists = fs.existsSync(requestedPath) ||
      fs.existsSync(requestedHtmlPath);

    if (!fileExists) {
      logger.warn('404_REDIRECT', 'PÃ¡gina no encontrada, redirigiendo a error-404', {
        path: req.path,
        originalUrl: req.originalUrl
      });

      // Servir directamente la nueva pÃ¡gina de error 404 personalizada
      const error404Path = path.join(__dirname, 'public', 'error-404.html');
      if (fs.existsSync(error404Path)) {
        return res.status(404).sendFile(error404Path);
      } else {
        // Si por alguna razÃ³n no existe, crear nuevamente y servir
        createNewError404Page();
        return res.status(404).sendFile(error404Path);
      }
    }
  }

  next();
});

// Aplicar middleware de autenticaciÃ³n DESPUÃ‰S de servir archivos estÃ¡ticos
app.use(verifyFirebaseAuth);

// ================================================================
// ðŸ“¡ API ENDPOINTS
// ================================================================

// Endpoint de anÃ¡lisis con Gemini
app.post("/api/analyze", async (req, res) => {
  const { movieTitle, movieDescription } = req.body;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    logger.error('GEMINI_API', 'GEMINI_API_KEY no configurada');
    return res.status(500).json({ error: "GEMINI_API_KEY no configurada en el servidor" });
  }

  const prompt = `ActÃºa como un crÃ­tico de cine experto y redacta un anÃ¡lisis completo y objetivo para la pelÃ­cula "${movieTitle}". Utiliza la siguiente sinopsis: "${movieDescription}". El anÃ¡lisis debe ser excelente, ordenado y adecuado para una aplicaciÃ³n mÃ³vil. El texto debe ser muy natural, sin utilizar caracteres de negrita (**). La respuesta debe incluir:
  1. Un pÃ¡rrafo introductorio.
  2. Un subtÃ­tulo: "Trama y Desarrollo".
  3. Un subtÃ­tulo: "Aspectos Destacados" seguido de una lista de 3 a 5 puntos clave (actuaciÃ³n, direcciÃ³n, fotografÃ­a, etc.).
  4. Un subtÃ­tulo: "Veredicto Final" con un pÃ¡rrafo de conclusiÃ³n.
  AsegÃºrate de que todo el texto generado fluya de manera natural y estÃ© formateado con subtÃ­tulos y listas.`;

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
    res.status(500).json({ error: "Error al procesar el anÃ¡lisis con Gemini" });
  }
});

// Endpoint de configuraciÃ³n
app.get("/api/config", (req, res) => {
  logger.info('API_CONFIG', 'Solicitud de configuraciÃ³n recibida');

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

// Endpoint de validaciÃ³n de reCAPTCHA
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
    logger.error(context, 'Error en validaciÃ³n reCAPTCHA', error);

    res.status(400).json({
      success: false,
      error: error.message || 'reCAPTCHA validation failed',
      timestamp: new Date().toISOString()
    });
  }
});

// âœ… MODIFICADO: Endpoint de login - Ahora maneja el parÃ¡metro returnTo
app.post("/api/login", async (req, res) => {
  const context = 'LOGIN_API';

  try {
    const { email, password, recaptchaResponse, returnTo, deviceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'deviceId is required'
      });
    }

    await validateRecaptcha(recaptchaResponse);

    logger.info(context, 'Login iniciado con reCAPTCHA validado', { email, returnTo });

    // ================================================================
    // ðŸ” SEGURIDAD DE SESIÃ“N POR DISPOSITIVO
    // ================================================================

    if (db) {
      const currentDeviceId = deviceId;
      const currentIp = getClientIp(req);

      const userSnap = await db.collection("usuarios")
        .where("email", "==", email)
        .limit(1)
        .get();

      if (!userSnap.empty) {
        const userDoc = userSnap.docs[0];
        const userRef = userDoc.ref;
        const userData = userDoc.data() || {};

        if (userData.lastDeviceId && userData.lastDeviceId !== currentDeviceId) {
          // âœ… INTEGRADO: Alerta de inicio de sesiÃ³n desde nuevo dispositivo
          await alertaLogin(userData.email || email, userData.name || email.split('@')[0]);
        }

        await userRef.set({
          lastDeviceId: currentDeviceId,
          lastIp: currentIp,
          lastLogin: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    // âœ… MEJORA: Usar returnTo si estÃ¡ presente, de lo contrario ir a actividad
    const redirectPath = returnTo && returnTo !== 'undefined' && returnTo !== 'null' ? returnTo : '/actividad';

    logger.info(context, 'Login exitoso, redirigiendo', { email, redirectPath });

    res.json({
      success: true,
      message: 'Login successful (reCAPTCHA validated)',
      redirectTo: redirectPath,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(context, 'Error en login', error);

    res.status(400).json({
      success: false,
      error: error.message || 'Login failed',
      timestamp: new Date().toISOString()
    });
  }
});

// âœ… MODIFICADO: Endpoint de registro - Ahora maneja el parÃ¡metro returnTo
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

    // ================================================================
    // ðŸ§± ANTI-MULTICUENTA POR deviceId
    // ================================================================

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
          // âœ… INTEGRADO: Alerta de socio duplicado
          await socioDuplicado(email);

          return res.status(409).json({
            success: false,
            error: 'Registro bloqueado: deviceId ya existe con otro correo'
          });
        }
      }
    }

    // ================================================================
    // âœ‰ï¸ EMAIL DE BIENVENIDA
    // ================================================================

    // âœ… INTEGRADO: Correo de bienvenida
    await enviarBienvenida(email, name);

    // âœ… MEJORA: Guardar returnTo en localStorage del cliente para usarlo despuÃ©s de verificaciÃ³n
    // El cliente debe manejar esto, aquÃ­ solo lo pasamos de vuelta
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
        description: description || 'CrÃ©ditos Consulta PE',
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
      logger.info(context, 'ðŸ’³ Pago aprobado instantÃ¡neamente, otorgando beneficios', {
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
      logger.info(context, 'â³ Pago no aprobado instantÃ¡neamente, esperando webhook', {
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
        logger.error(context, 'Error especÃ­fico de Mercado Pago', null, {
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

  logger.info(context, 'ðŸ“© Webhook recibido', {
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

      logger.info(context, 'ðŸ” Consultando informaciÃ³n del pago', { paymentId });

      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      logger.info(context, 'ðŸ“„ InformaciÃ³n del pago obtenida', {
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
          logger.info(context, 'âœ… Procesando pago aprobado via webhook', {
            paymentId, uid, email, amount
          });

          const beneficioResult = await otorgarBeneficio(
            uid,
            email,
            Number(amount),
            'MP_WEBHOOK',
            paymentId.toString()
          );

          logger.info(context, 'ðŸ“Š Resultado del webhook', {
            paymentId,
            uid,
            beneficioStatus: beneficioResult.status,
            message: beneficioResult.message || 'Procesado correctamente',
            wasAlreadyProcessed: beneficioResult.status === 'already_processed',
            pdfUrl: beneficioResult.pdfUrl || null
          });

        } else {
          logger.error(context, 'âŒ UID no encontrado en metadatos del pago', null, {
            paymentId,
            metadata,
            payer: paymentInfo.payer
          });
        }
      } else {
        logger.info(context, 'â¸ï¸ Pago no estÃ¡ aprobado, ignorando', {
          paymentId,
          status: paymentInfo.status
        });
      }

    } catch (error) {
      logger.error(context, 'âŒ Error procesando webhook', error, {
        paymentId: webhookData.data?.id,
        action: webhookData.action
      });
    }
  } else {
    logger.info(context, 'â„¹ï¸ Evento no relevante ignorado', {
      action: webhookData.action,
      type: webhookData.type
    });
  }
});

// Endpoint para obtener informaciÃ³n del pago
app.get("/api/payment/:paymentId", async (req, res) => {
  const context = 'GET_PAYMENT_INFO';
  const { paymentId } = req.params;

  try {
    logger.info(context, 'Obteniendo informaciÃ³n del pago', { paymentId });

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
    logger.error(context, 'Error obteniendo informaciÃ³n del pago', error, { paymentId });
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

    logger.info(context, 'Solicitud para generar boleta electrÃ³nica', { paymentId });

    let existingPdfUrl = null;
    let responseSent = false;

    if (db) {
      try {
        const doc = await db.collection("pagos_registrados").doc(String(paymentId)).get();
        if (doc.exists) {
          const pagoData = doc.data();

          if (pagoData.pdfUrl) {
            existingPdfUrl = pagoData.pdfUrl;
            logger.info(context, 'âœ… PDF ya existe en datos del pago', {
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
      logger.info(context, 'âœ… PDF ya existe en Storage', {
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

    logger.info(context, 'ðŸ“„ Generando nuevo comprobante', { paymentId });

    const invoiceData = {
      orderId: String(paymentId),
      date: new Date().toLocaleString('es-PE'),
      email: email || 'cliente@example.com',
      amount: amount || 10,
      credits: credits || 60,
      description: description || 'CrÃ©ditos Consulta PE',
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

      logger.info(context, 'âœ… PDF generado y almacenado en Storage', {
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
    logger.error(context, 'âŒ Error generando comprobante', error, req.body);
    res.status(500).json({
      success: false,
      error: 'Error generando comprobante',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Endpoint para opciones de facturaciÃ³n
app.get("/api/invoice-options", (req, res) => {
  logger.info('INVOICE_OPTIONS', 'Solicitud de opciones de facturaciÃ³n');
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
      pdfGenerator: true
    },
    environment: process.env.NODE_ENV || 'development',
    hostUrl: HOST_URL,
    flyAppName: process.env.FLY_APP_NAME,
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    processedPaymentsCacheSize: processedPaymentsCache.size,
    activePaymentLocks: paymentLocks.size,
    security: {
      recaptchaSiteKey: RECAPTCHA_SITE_KEY,
      authMiddleware: true,
      publicRoutes: PUBLIC_ROUTES,
      protectedRoutes: PROTECTED_ROUTES,
      publicApiRoutes: PUBLIC_API_ROUTES
    }
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
    FIREBASE_TYPE: process.env.FIREBASE_TYPE ? 'âœ”' : 'âœ—',
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ? 'âœ”' : 'âœ—',
    FIREBASE_PRIVATE_KEY_ID: process.env.FIREBASE_PRIVATE_KEY_ID ? 'âœ”' : 'âœ—',
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? 'âœ” (length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : 'âœ—',
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ? 'âœ”' : 'âœ—',
    FIREBASE_CLIENT_ID: process.env.FIREBASE_CLIENT_ID ? 'âœ”' : 'âœ—',
    FIREBASE_CLIENT_X509_CERT_URL: process.env.FIREBASE_CLIENT_X509_CERT_URL ? 'âœ”' : 'âœ—',
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET ? 'âœ”' : 'âœ—'
  };

  const missingVars = Object.entries(firebaseVars)
    .filter(([key, value]) => value === 'âœ—')
    .map(([key]) => key);

  res.json({
    firebaseVars,
    missingVars,
    adminInitialized: !!admin.apps.length,
    firestoreAvailable: !!db,
    storageAvailable: !!bucket,
    timestamp: new Date().toISOString()
  });
});

// Limpiar cache
app.post("/api/admin/clear-cache", (req, res) => {
  const context = 'ADMIN_CLEAR_CACHE';

  try {
    const cacheSize = processedPaymentsCache.size;
    const locksSize = paymentLocks.size;

    processedPaymentsCache.clear();
    paymentLocks.clear();

    logger.info(context, 'ðŸ§¹ Cache limpiado manualmente', {
      paymentsRemoved: cacheSize,
      locksRemoved: locksSize
    });

    res.json({
      success: true,
      message: 'Cache cleared successfully',
      paymentsRemoved: cacheSize,
      locksRemoved: locksSize
    });
  } catch (error) {
    logger.error(context, 'Error limpiando cache', error);
    res.status(500).json({ error: 'Error clearing cache' });
  }
});

// ================================================================
// ðŸ  RUTAS PRINCIPALES
// ================================================================

// PÃ¡gina principal: Servir home.html
app.get("/", (req, res) => {
  logger.info('ROOT_HOME', 'Sirviendo home.html como pÃ¡gina principal');
  const homePath = path.join(__dirname, 'public', 'home.html');
  if (fs.existsSync(homePath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(homePath);
  } else {
    res.status(404).send('Home page not found');
  }
});

// Ruta de informaciÃ³n de la API
app.get("/api", (req, res) => {
  res.json({
    message: "API de Pagos Consulta PE",
    version: "3.2.0 - RedirecciÃ³n AutomÃ¡tica despuÃ©s del Login/Registro",
    features: {
      cleanUrls: "âœ… URLs sin .html",
      custom404: "âœ… PÃ¡gina error-404 personalizada",
      authMiddleware: "âœ… Control de acceso con Firebase",
      autoRedirect: "âœ… RedirecciÃ³n automÃ¡tica a login",
      returnTo: "âœ… RedirecciÃ³n despuÃ©s del login/registro a pÃ¡gina original",
      returnAfterVerify: "âœ… RedirecciÃ³n despuÃ©s de verificar correo",
      publicRoutes: "âœ… Rutas pÃºblicas configurables",
      protectedRoutes: "âœ… Rutas protegidas configurables",
      routeMapping: "âœ… Mapeo lÃ³gico de rutas implementado",
      easyToExpand: "âœ… FÃ¡cil de agregar nuevas pÃ¡ginas"
    },
    routes: {
      public: PUBLIC_ROUTES,
      protected: PROTECTED_ROUTES,
      publicApi: PUBLIC_API_ROUTES
    },
    routeMapping: {
      '/user/activity': 'actividad.html',
      '/actividad': 'actividad.html',
      '/peliculas': 'PeliPREX.html'
    },
    howToAddPages: {
      publicPage: "Agregar ruta a PUBLIC_ROUTES array",
      protectedPage: "Agregar ruta a PROTECTED_ROUTES array (requiere login)",
      publicApi: "Agregar ruta a PUBLIC_API_ROUTES array",
      customMapping: "Agregar mapeo en routeMap objeto dentro del middleware"
    },
    status: "online",
    timestamp: new Date().toISOString()
  });
});

// ================================================================
// âš ï¸ MANEJO DE ERRORES GLOBAL
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

// Catch-all final para rutas no encontradas
app.get("*", (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  const error404Path = path.join(__dirname, 'public', 'error-404.html');
  if (fs.existsSync(error404Path)) {
    res.status(404).sendFile(error404Path);
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>404 - PÃ¡gina no encontrada</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          h1 { font-size: 72px; margin: 0; }
          p { font-size: 24px; margin: 20px 0; }
          a { 
            color: white; 
            text-decoration: none; 
            background: rgba(255,255,255,0.2);
            padding: 10px 20px;
            border-radius: 5px;
            display: inline-block;
            margin-top: 20px;
          }
          a:hover { background: rgba(255,255,255,0.3); }
        </style>
      </head>
      <body>
        <h1>404</h1>
        <p>PÃ¡gina no encontrada</p>
        <p>Lo sentimos, la pÃ¡gina que buscas no existe.</p>
        <a href="/">Volver al inicio</a>
      </body>
      </html>
    `);
  }
});

// ================================================================
// ðŸš€ INICIO DEL SERVIDOR
// ================================================================

const PORT = process.env.PORT || 80;
app.listen(PORT, "0.0.0.0", () => {
  logger.info('SERVER', `ðŸš€ Servidor iniciado en puerto ${PORT}`, {
    hostUrl: HOST_URL,
    nodeEnv: process.env.NODE_ENV,
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    version: '3.2.0',
    features: {
      authMiddleware: 'Activo',
      publicRoutes: PUBLIC_ROUTES.length,
      protectedRoutes: PROTECTED_ROUTES.length,
      publicApiRoutes: PUBLIC_API_ROUTES.length,
      custom404: 'Activo',
      cleanUrls: 'Activo',
      routeMapping: 'âœ… Implementado',
      autoRedirectToLogin: 'âœ… Activado',
      returnAfterLogin: 'âœ… Implementado',
      returnAfterRegister: 'âœ… Implementado con verify.html',
      returnAfterVerify: 'âœ… Debe implementarse en frontend'
    },
    timestamp: new Date().toISOString()
  });
});
