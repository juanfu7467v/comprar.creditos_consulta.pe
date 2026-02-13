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
// ✉️ CONFIGURACIÓN DE RESEND (SEGURIDAD)
// ================================================================
const resend = new Resend(process.env.RESEND_API_KEY);

// ================================================================
// 🌐 HELPERS DE IP Y LOCALIZACIÓN
// ================================================================
function getClientIp(req) {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.length > 0) {
    return xForwardedFor.split(",")[0].trim();
  }
  return req.ip;
}

// ================================================================
// 🔑 CONFIGURACIÓN DE RUTAS Y CONTROL DE ACCESO
// ================================================================

const PUBLIC_ROUTES = [
  '/login', '/login.html', '/register', '/register.html', '/error-404', '/error-404.html',
  '/', '/home', '/home.html', '/politica-privacidad', '/politica-privacidad.html',
  '/terminos-condiciones', '/terminos-condiciones.html', '/politica.compras',
  '/politica.compras.html', '/aviso-legal-peliprex', '/aviso-legal-peliprex.html',
  '/disclaimer-apis', '/disclaimer-apis.html', '/API-Docs', '/API-Docs.html'
];

const PROTECTED_ROUTES = [
  '/favoritos', '/favoritos.html', '/historial', '/historial.html', '/planes', '/planes.html',
  '/verify', '/verify.html', '/PeliPREX', '/PeliPREX.html', '/actividad', '/actividad.html',
  '/api-key', '/api-key.html', '/checkout', '/checkout.html', '/user/activity', '/peliculas'
];

const PUBLIC_API_ROUTES = [
  '/api/auth', '/api/login', '/api/register', '/api/config', '/api/health', '/api/webhook',
  '/api/validate-recaptcha', '/api/pay', '/api/webhook/mercadopago', '/api/payment',
  '/api/generate-invoice', '/api/invoice-options', '/api/debug/firebase', '/api/analyze'
];

// ================================================================
// 📝 LOGGER MEJORADO
// ================================================================
const logger = {
  info: (context, message, data = {}) => {
    console.log(`[${new Date().toISOString()}] [INFO] [${context}] ${message}`, data);
  },
  error: (context, message, error = null, data = {}) => {
    console.error(`[${new Date().toISOString()}] [ERROR] [${context}] ${message}`, error || '', data);
  },
  warn: (context, message, data = {}) => {
    console.warn(`[${new Date().toISOString()}] [WARN] [${context}] ${message}`, data);
  }
};

// ================================================================
// 🔥 INICIALIZACIÓN DE FIREBASE
// ================================================================
function buildServiceAccountFromEnv() {
  try {
    return {
      "project_id": process.env.FIREBASE_PROJECT_ID,
      "private_key": process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      "client_email": process.env.FIREBASE_CLIENT_EMAIL,
    };
  } catch (e) { return null; }
}

let db, bucket;
const serviceAccount = buildServiceAccountFromEnv();

if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
  db = admin.firestore();
  bucket = admin.storage().bucket();
  db.settings({ ignoreUndefinedProperties: true });
}

// ================================================================
// 🛡️ RECAPTCHA VALIDATION
// ================================================================
const RECAPTCHA_SECRET_KEY = process.env.RECAPCHA_CLAVE_SECRETA;
const RECAPTCHA_SITE_KEY = "6Lc4OGIsAAAAAPrAnOprbzd-ATbUOWHXK3Yl_bVy";

async function validateRecaptcha(token) {
  if (!token) throw new Error('Token reCAPTCHA requerido');
  const response = await axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${token}`);
  if (!response.data.success) throw new Error('Fallo validación reCAPTCHA');
  return true;
}

// ================================================================
// 💳 MERCADO PAGO CONFIG
// ================================================================
const mpClient = process.env.MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN.trim()
}) : null;

const HOST_URL = process.env.HOST_URL || `https://${process.env.FLY_APP_NAME}.fly.dev`;
const processedPaymentsCache = new Map();
const paymentLocks = new Map();

// ================================================================
// 🔐 MIDDLEWARE DE AUTENTICACIÓN
// ================================================================
async function verifyFirebaseAuth(req, res, next) {
  const isPublic = PUBLIC_ROUTES.some(r => req.path === r) || PUBLIC_API_ROUTES.some(r => req.path.startsWith(r));
  const isStatic = /\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf)$/i.test(req.path);

  if (isPublic || isStatic) return next();

  try {
    const authHeader = req.headers.authorization;
    let idToken;

    if (authHeader?.startsWith('Bearer ')) {
      idToken = authHeader.split('Bearer ')[1];
    } else {
      const cookies = req.headers.cookie?.split(';').find(c => c.trim().startsWith('__session='));
      if (cookies) idToken = cookies.split('=')[1].trim();
    }

    if (!idToken) return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    req.uid = decodedToken.uid;
    next();
  } catch (error) {
    res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }
}

// ================================================================
// ⚙️ LOGICA DE NEGOCIO (BENEFICIOS)
// ================================================================
const PAQUETES_CREDITOS = { 10: 60, 20: 125, 30: 200, 50: 330, 100: 700, 200: 1500 };
const PLANES_ILIMITADOS = { 60: 7, 80: 15, 110: 30, 160: 60, 510: 70 };

async function acquirePaymentLock(id) {
  if (paymentLocks.has(id)) return false;
  paymentLocks.set(id, Date.now());
  return true;
}

async function uploadPDFToStorage(pdfPath, paymentId) {
  const fileName = `invoices/${paymentId}.pdf`;
  await bucket.upload(pdfPath, { destination: fileName });
  const file = bucket.file(fileName);
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
}

async function otorgarBeneficio(uid, email, monto, processor, paymentRef) {
  if (processedPaymentsCache.has(paymentRef)) return { status: 'already_processed' };
  if (!(await acquirePaymentLock(paymentRef))) return { status: 'error' };

  try {
    const pagoDoc = db.collection("pagos_registrados").doc(paymentRef);
    const userDoc = db.collection("usuarios").doc(uid);

    const result = await db.runTransaction(async (t) => {
      const user = await t.get(userDoc);
      const userData = user.data();
      const montoNum = Number(monto);
      let updates = { ultimaCompra: admin.firestore.FieldValue.serverTimestamp() };

      if (PAQUETES_CREDITOS[montoNum]) {
        updates.creditos = (userData.creditos || 0) + PAQUETES_CREDITOS[montoNum];
        updates.tipoPlan = "creditos";
      } else if (PLANES_ILIMITADOS[montoNum]) {
        const dias = PLANES_ILIMITADOS[montoNum];
        const fin = moment().add(dias, 'days').toDate();
        updates.planIlimitadoHasta = fin;
        updates.tipoPlan = "ilimitado";
        updates.creditos = 0;
      }

      t.update(userDoc, updates);
      t.set(pagoDoc, { uid, email, monto, procesado: true, fecha: new Date() }, { merge: true });
      return { status: 'success', updates };
    });

    // Generar PDF automático
    try {
      const pathPdf = await generateInvoicePDF({ orderId: paymentRef, amount: monto, email });
      const url = await uploadPDFToStorage(path.join(__dirname, 'public', pathPdf), paymentRef);
      await pagoDoc.update({ pdfUrl: url });
      result.pdfUrl = url;
    } catch (e) { logger.error('PDF', 'Error generando boleta', e); }

    processedPaymentsCache.set(paymentRef, true);
    paymentLocks.delete(paymentRef);
    return result;
  } catch (e) {
    paymentLocks.delete(paymentRef);
    throw e;
  }
}

// ================================================================
// 🚀 RUTAS DE SERVIDOR Y MANEJADORES
// ================================================================

// 1. Rutas Estáticas Directas (Fix para 404)
app.get("/user/activity", (req, res) => res.sendFile(path.join(__dirname, "public", "actividad.html")));
app.get("/peliculas", (req, res) => res.sendFile(path.join(__dirname, "public", "PeliPREX.html")));
app.get("/disclaimer-apis", (req, res) => res.sendFile(path.join(__dirname, "public", "disclaimer-apis.html")));
app.get("/API-Docs", (req, res) => res.sendFile(path.join(__dirname, "public", "API-Docs.html")));

app.use(express.static(path.join(__dirname, 'public')));

// Middleware de Clean URLs
app.use((req, res, next) => {
  if (!req.path.includes('.') && !req.path.startsWith('/api/') && req.path !== '/') {
    const htmlPath = path.join(__dirname, 'public', `${req.path.replace(/^\//, '')}.html`);
    if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
  }
  next();
});

// Middleware de Error 404 personalizado
app.use((req, res, next) => {
  const isApi = req.path.startsWith('/api/');
  if (!isApi && req.path !== '/') {
    const errorPage = path.join(__dirname, 'public', 'error-404.html');
    if (fs.existsSync(errorPage)) return res.status(404).sendFile(errorPage);
  }
  next();
});

app.use(verifyFirebaseAuth);

// ================================================================
// 📡 ENDPOINTS API
// ================================================================

app.post("/api/login", async (req, res) => {
  try {
    const { email, recaptchaResponse, deviceId } = req.body;
    await validateRecaptcha(recaptchaResponse);

    const userSnap = await db.collection("usuarios").where("email", "==", email).limit(1).get();
    if (!userSnap.empty) {
      const userDoc = userSnap.docs[0];
      const userData = userDoc.data();
      
      if (userData.lastDeviceId && userData.lastDeviceId !== deviceId) {
        await resend.emails.send({
          from: 'Seguridad <seguridad@masitaprex.com>',
          to: email,
          subject: '⚠️ Alerta de Inicio de Sesión',
          html: `<p>Nuevo inicio de sesión desde IP: ${getClientIp(req)}</p>`
        });
      }
      await userDoc.ref.update({ lastDeviceId: deviceId, lastIp: getClientIp(req) });
    }
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/register", async (req, res) => {
  try {
    const { email, recaptchaResponse, deviceId } = req.body;
    await validateRecaptcha(recaptchaResponse);

    // Anti-Multicuenta
    const deviceSnap = await db.collection("usuarios").where("deviceId", "==", deviceId).get();
    if (!deviceSnap.empty) {
      const existingEmail = deviceSnap.docs[0].data().email;
      if (existingEmail !== email) {
        return res.status(403).json({ error: "Este dispositivo ya tiene una cuenta asociada." });
      }
    }

    await resend.emails.send({
      from: 'Bienvenido <hola@masitaprex.com>',
      to: email,
      subject: '¡Bienvenido a Masitaprex!',
      html: `<h1>Hola!</h1><p>Gracias por registrarte desde la IP ${getClientIp(req)}</p>`
    });

    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/pay", async (req, res) => {
  try {
    const { token, amount, email, uid } = req.body;
    const payment = new Payment(mpClient);
    const result = await payment.create({
      body: { 
        transaction_amount: Number(amount), token, description: 'Consulta PE', 
        installments: 1, payment_method_id: req.body.payment_method_id,
        payer: { email }, notification_url: `${HOST_URL}/api/webhook/mercadopago`,
        metadata: { uid, email, amount }
      }
    });

    if (result.status === 'approved') {
      await otorgarBeneficio(uid, email, amount, 'CARD', result.id.toString());
    }
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/webhook/mercadopago", async (req, res) => {
  const { data, action } = req.body;
  if (action === 'payment.created' || req.body.type === 'payment') {
    const p = new Payment(mpClient);
    const info = await p.get({ id: data.id });
    if (info.status === 'approved') {
      await otorgarBeneficio(info.metadata.uid, info.metadata.email, info.metadata.amount, 'WEBHOOK', data.id.toString());
    }
  }
  res.sendStatus(200);
});

// Final Catch-all
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

const PORT = process.env.PORT || 80;
app.listen(PORT, "0.0.0.0", () => {
  logger.info('SERVER', `🚀 Corriendo en puerto ${PORT} - Versión Final`);
});
