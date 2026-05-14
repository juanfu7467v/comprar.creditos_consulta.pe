import express from "express";
import admin from "firebase-admin";
import crypto from "crypto";
import cors from "cors";
import cookieParser from "cookie-parser";
import { MercadoPagoConfig, Payment } from "mercadopago";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import { Resend } from "resend";
import helmet from "helmet";
import { helmetConfig } from './cspConfig.js';
import ReturnConfigServer from './returnConfigServer.js';

// Importar nuevos módulos
import { 
  logger, 
  getClientIp, 
  checkLoginBlock, 
  registerFailedLogin, 
  resetLoginAttempts, 
  validateRecaptcha,
  generateFingerprint,
  getLocationFromIP,
  RECAPTCHA_SITE_KEY,
  MAX_LOGIN_ATTEMPTS,
  BLOCK_DURATION_HOURS
} from './seguridad.js';

import { 
  initFirebase, 
  buildServiceAccountFromEnv, 
  db, 
  otorgarBeneficio, 
  enviarBienvenida, 
  enviarCorreoSospechoso,
  enviarCorreoRechazo,
  enviarCorreoSoporte,
  createSessionCookie,
  PAQUETES_CREDITOS,
  PLANES_ILIMITADOS
} from './negocios.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');

// ================================================================
// 🔒 CONFIGURACIÓN CORS
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
app.use(helmet(helmetConfig));

app.use('/api', (req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  next();
});

// ================================================================
// ✉️ CONFIGURACIÓN DE RESEND
// ================================================================

const resend = new Resend(process.env.RESEND_API_KEY);

// ================================================================
// 🔥 INICIALIZACIÓN DE FIREBASE
// ================================================================

const serviceAccount = buildServiceAccountFromEnv();
if (serviceAccount) {
  // Inicialización asíncrona para acelerar el cold start
  initFirebase(serviceAccount).catch(err => {
    logger.error('FIREBASE', 'Error crítico en inicialización asíncrona', err);
  });
} else {
  logger.error('FIREBASE', 'No se pudo inicializar Firebase - Service account no disponible');
}

// ================================================================
// 💳 CONFIGURACIÓN DE MERCADO PAGO
// ================================================================

const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const HOST_URL = process.env.HOST_URL || `https://${process.env.FLY_APP_NAME}.fly.dev`;

const mpClient = MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({
  accessToken: MERCADOPAGO_ACCESS_TOKEN.trim(),
  options: { timeout: 10000 }
}) : null;

// ================================================================
// 🛣️ RUTAS DE LA API
// ================================================================

// Endpoint de login exitoso
app.post("/api/login-success", async (req, res) => {
  const context = 'LOGIN_SUCCESS_API';
  try {
    const { email, uid, displayName, isNewUser, idToken, deviceModel } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    // Verificar si es un inicio de sesión desde un dispositivo nuevo/sospechoso
    try {
      if (db && uid) {
        const userRef = db.collection("usuarios").doc(uid);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const lastDevice = userData.lastDeviceModel;
          
          // Si ya tenía un dispositivo registrado y el actual es diferente, es sospechoso
          if (lastDevice && deviceModel && lastDevice !== deviceModel) {
            const ip = getClientIp(req);
            const location = await getLocationFromIP(ip);
            const nombre = displayName || userData.name || email.split('@')[0];
            
            logger.warn(context, '⚠️ Inicio de sesión sospechoso detectado (cambio de dispositivo)', {
              email, uid, oldDevice: lastDevice, newDevice: deviceModel, ip
            });
            
            // Enviar correo de alerta (sin bloquear el flujo principal)
            enviarCorreoSospechoso(email, nombre, location, ip, req.headers['user-agent'], resend)
              .catch(err => logger.error(context, 'Error enviando correo sospechoso', err));
          }
          
          // Actualizar el modelo del último dispositivo
          if (deviceModel) {
            await userRef.update({ 
              lastDeviceModel: deviceModel,
              lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }
      }
    } catch (deviceError) {
      logger.error(context, 'Error verificando dispositivo sospechoso', deviceError);
    }

    await resetLoginAttempts(email);

    if (idToken && admin.apps.length) {
      try {
        const { sessionCookie, expiresIn } = await createSessionCookie(idToken);
        res.cookie('__session', sessionCookie, {
          httpOnly: true, secure: true, sameSite: 'strict', maxAge: expiresIn, path: '/'
        });
      } catch (cookieError) {
        logger.warn(context, 'No se pudo crear session cookie', cookieError);
      }
    }

	    if (isNewUser && uid) {
	      const nombre = displayName || email.split('@')[0];
	      const welcomeResult = await enviarBienvenida(email, nombre, resend);
	      
	      // Asegurar que Firestore esté listo (máximo 5 segundos de espera)
	      let waitAttempts = 0;
	      while (!db && waitAttempts < 10) {
	        await new Promise(r => setTimeout(r, 500));
	        waitAttempts++;
	      }

	      if (db) {
	        const userRef = db.collection("usuarios").doc(uid);
	        const userDoc = await userRef.get();
        const updateData = { lastLogin: admin.firestore.FieldValue.serverTimestamp() };
        if (!userDoc.exists || userDoc.data().creditos === undefined) {
          updateData.creditos = 11;
          updateData.tipoPlan = "creditos";
        }
        if (welcomeResult.success) {
          updateData.welcomeEmailSent = true;
          updateData.welcomeEmailSentAt = admin.firestore.FieldValue.serverTimestamp();
        }
        await userRef.set(updateData, { merge: true });

        // Nueva lógica: Guardar en colección "empresas" y generar token seguro
        const empresaRef = db.collection("empresas").doc(uid);
        const secureToken = crypto.randomBytes(32).toString('hex');
        await empresaRef.set({
          uid,
          email,
          nombre,
          apiToken: secureToken,
          token: secureToken, // Mantener consistencia entre apiToken y token
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'active'
        }, { merge: true });
        logger.info(context, 'Datos guardados en colección empresas', { uid, email });
      }
    }

    const cookieOptions = {
      httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000, path: '/'
    };
    res.cookie('user_email', email, cookieOptions);
    res.cookie('user_uid', uid, cookieOptions);

    res.json({ success: true, message: 'Login success', timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error(context, 'Error procesando login exitoso', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Endpoint de notificación de verificación
app.post("/api/notify-verification", async (req, res) => {
  const context = 'NOTIFY_VERIFICATION';
  try {
    const { uid, email, displayName } = req.body;
    if (!uid || !email) return res.status(400).json({ success: false, error: 'Se requiere uid y email' });

	    // Asegurar que Firestore esté listo
	    let waitAttempts = 0;
	    while (!db && waitAttempts < 10) {
	      await new Promise(r => setTimeout(r, 500));
	      waitAttempts++;
	    }

	    let alreadySent = false;
	    if (db) {
	      const userDoc = await db.collection("usuarios").doc(uid).get();
	      if (userDoc.exists && userDoc.data().welcomeEmailSent) alreadySent = true;
	    }

    if (!alreadySent) {
      const result = await enviarBienvenida(email, displayName || email.split('@')[0], resend);
      if (result.success && db) {
        await db.collection("usuarios").doc(uid).set({
          welcomeEmailSent: true,
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        const userDoc = await db.collection("usuarios").doc(uid).get();
        if (!userDoc.exists || userDoc.data().creditos === undefined) {
          await db.collection("usuarios").doc(uid).set({ creditos: 11, tipoPlan: "creditos" }, { merge: true });
        }

        // Nueva lógica: Guardar en colección "empresas" y generar token seguro tras verificación
        const empresaRef = db.collection("empresas").doc(uid);
        const secureToken = crypto.randomBytes(32).toString('hex');
        await empresaRef.set({
          uid,
          email,
          nombre: displayName || email.split('@')[0],
          apiToken: secureToken,
          token: secureToken, // Mantener consistencia entre apiToken y token
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'active'
        }, { merge: true });
        logger.info(context, 'Datos guardados en colección empresas tras verificación', { uid, email });
      }
      return res.json({ success: result.success, message: result.success ? 'Correo enviado' : 'Error enviando correo' });
    }
    res.json({ success: true, message: 'Ya enviado' });
  } catch (error) {
    logger.error(context, 'Error en notificación', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Endpoint de análisis con Gemini
app.post("/api/analyze", async (req, res) => {
  const { movieTitle, movieDescription } = req.body;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

  const prompt = `Actúa como un crítico de cine experto y redacta un análisis completo para "${movieTitle}". Sinopsis: "${movieDescription}". Sin negritas.`;
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json' } }
    );
    res.json(response.data);
  } catch (error) {
    logger.error('GEMINI_API', 'Error en Gemini', error);
    res.status(500).json({ error: "Error en Gemini" });
  }
});

// Endpoint de configuración
app.get("/api/config", (req, res) => {
  res.json({
    mercadopagoPublicKey: process.env.MERCADOPAGO_PUBLIC_KEY,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    firebaseConfig: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      measurementId: process.env.FIREBASE_MEASUREMENT_ID
    },
    environment: process.env.NODE_ENV || 'production',
    peliprexBaseUrl: process.env.PELIPREX_BASE_URL,
    timestamp: new Date().toISOString()
  });
});

// Endpoint de validación de reCAPTCHA
app.post("/api/validate-recaptcha", async (req, res) => {
  try {
    const { recaptchaResponse } = req.body;
    const result = await validateRecaptcha(recaptchaResponse, process.env.RECAPTCHA_CLAVE_SECRETA);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Endpoint de login con bloqueo
app.post("/api/login", async (req, res) => {
  const context = 'LOGIN_API';
  try {
    const { email, recaptchaResponse, deviceId, deviceModel } = req.body;
    if (!email || !deviceId) return res.status(400).json({ success: false, error: 'Email and deviceId required' });

    const blockStatus = await checkLoginBlock(email);
    if (blockStatus.isBlocked) {
      return res.status(403).json({ success: false, error: 'account_blocked', remainingMinutes: blockStatus.remainingMinutes });
    }

    if (recaptchaResponse) {
      await validateRecaptcha(recaptchaResponse, process.env.RECAPTCHA_CLAVE_SECRETA);
    }

    res.json({ success: true, message: 'Login allowed' });
  } catch (error) {
    logger.error(context, 'Error en login', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Endpoint para reportar login fallido
app.post("/api/report-failed-login", async (req, res) => {
  const context = 'REPORT_FAILED_LOGIN';
  try {
    const { email, deviceModel, errorType } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const result = await registerFailedLogin(email, req, deviceModel);
    if (result.blocked) {
      const ip = getClientIp(req);
      const location = await getLocationFromIP(ip);
      await enviarCorreoSospechoso(email, null, location, ip, req.headers['user-agent'], resend);
    }
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error(context, 'Error reportando fallo', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Endpoint de pago
app.post("/api/pay", async (req, res) => {
  const context = 'PAY_API';
  try {
    const { transaction_amount, token, description, installments, payment_method_id, payer, uid, tipoPlan } = req.body;
    if (!mpClient) return res.status(503).json({ error: 'Mercado Pago not configured' });

    // Validación defensiva para evitar errores de 'undefined'
    if (!payer || !payer.email) {
      logger.error(context, 'Payer email missing in request body');
      return res.status(400).json({ error: 'Payer email is required' });
    }

    const payment = new Payment(mpClient);
    const result = await payment.create({
      body: {
        transaction_amount: Number(transaction_amount),
        token,
        description,
        installments: Number(installments),
        payment_method_id,
        payer,
        notification_url: `${HOST_URL}/api/webhook/mercadopago`,
        metadata: { uid, email: payer.email, amount: transaction_amount, tipoPlan }
      }
    });

    if (result.status === 'approved') {
      await otorgarBeneficio(uid, payer.email, transaction_amount, 'MP_CARD_INSTANT', result.id.toString(), resend, tipoPlan);
    } else if (result.status === 'rejected' || result.status === 'cancelled') {
      let userName = payer.email.split('@')[0];
      try {
        if (db) {
          // Buscar en usuarios o empresas
          const collectionName = tipoPlan === 'revenue_recovery' ? 'empresas' : 'usuarios';
          let userSnap = await db.collection(collectionName).doc(uid).get();
          if (!userSnap.exists) {
            const alternativeCollection = collectionName === 'empresas' ? 'usuarios' : 'empresas';
            userSnap = await db.collection(alternativeCollection).doc(uid).get();
          }
          if (userSnap.exists) {
            const userData = userSnap.data();
            userName = userData.name || userData.displayName || userData.nombre || userName;
          }
        }
      } catch (err) {}
      
      enviarCorreoRechazo(
        payer.email, 
        userName, 
        result.id.toString(), 
        transaction_amount, 
        description || 'Compra en Consulta PE', 
        result.status_detail || result.status, 
        resend
      ).catch(err => logger.error(context, 'Error enviando correo de rechazo', err));
    }
    res.json(result);
  } catch (error) {
    logger.error(context, 'Error en pago', error);
    res.status(400).json({ error: error.message });
  }
});

// Webhook de Mercado Pago
app.post("/api/webhook/mercadopago", async (req, res) => {
  const context = 'WEBHOOK_MP';
  const webhookData = req.body;
  res.sendStatus(200);

  if (!mpClient) return;
  const isPaymentEvent = webhookData.action?.includes('payment') || webhookData.type === 'payment';
  if (isPaymentEvent) {
    try {
      const paymentId = webhookData.data?.id || webhookData.id;
      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      if (paymentInfo.status === "approved") {
        const metadata = paymentInfo.metadata || {};
        if (metadata.uid) {
          await otorgarBeneficio(metadata.uid, metadata.email || paymentInfo.payer?.email, metadata.amount || paymentInfo.transaction_amount, 'MP_WEBHOOK', paymentId.toString(), resend, metadata.tipoPlan);
        }
      } else if (paymentInfo.status === "rejected" || paymentInfo.status === "cancelled") {
        const metadata = paymentInfo.metadata || {};
        const email = metadata.email || paymentInfo.payer?.email;
        const uid = metadata.uid;
        const tipoPlan = metadata.tipoPlan;
        
        if (email && uid) {
          let userName = email.split('@')[0];
          try {
            if (db) {
              const collectionName = tipoPlan === 'revenue_recovery' ? 'empresas' : 'usuarios';
              let userSnap = await db.collection(collectionName).doc(uid).get();
              if (!userSnap.exists) {
                const alternativeCollection = collectionName === 'empresas' ? 'usuarios' : 'empresas';
                userSnap = await db.collection(alternativeCollection).doc(uid).get();
              }
              if (userSnap.exists) {
                const userData = userSnap.data();
                userName = userData.name || userData.displayName || userData.nombre || userName;
              }
            }
          } catch (err) {}

          enviarCorreoRechazo(
            email,
            userName,
            paymentId.toString(),
            metadata.amount || paymentInfo.transaction_amount,
            paymentInfo.description || 'Compra en Consulta PE',
            paymentInfo.status_detail || paymentInfo.status,
            resend
          ).catch(err => logger.error(context, 'Error enviando correo de rechazo desde webhook', err));
        }
      }
    } catch (error) {
      logger.error(context, 'Error en webhook', error);
    }
  }
});

// Endpoint para obtener información del pago
app.get("/api/payment/:paymentId", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const pagoDoc = await db.collection("pagos_registrados").doc(req.params.paymentId).get();
    if (!pagoDoc.exists) return res.status(404).json({ error: 'Payment not found' });
    
    const data = pagoDoc.data();
    const fecha = data.fechaRegistro?.toDate() || new Date();
    res.json({
      id: req.params.paymentId,
      email: data.email,
      monto: data.monto,
      creditos: data.creditosOtorgados || 0,
      descripcion: data.descripcion,
      fecha: fecha.toLocaleDateString('es-PE'),
      hora: fecha.toLocaleTimeString('es-PE'),
      estado: data.estado,
      procesado: data.procesado,
      tipoPlan: data.tipoPlanNuevo || 'creditos',
      pdfUrl: data.pdfUrl || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Servir archivos estáticos y manejo de rutas
const PUBLIC_ROUTES = ['/login', '/register', '/verify', '/reset-password', '/disclaimer-apis', '/API-Docs'];
// Función para inyectar Google Analytics en el HTML
const injectGA = (html) => {
  const gaId = process.env.GOOGLE_ANALYTICS_ID;
  if (!gaId) return html;

  const gaScript = `
    <!-- Google Analytics 4 (GA4) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaId}', {
        page_path: window.location.pathname,
      });
    </script>
  `;
  
  // Insertar antes del cierre de </head> o al principio si no existe
  if (html.includes('</head>')) {
    return html.replace('</head>', `${gaScript}</head>`);
  }
  return gaScript + html;
};

// Lista de User-Agents de bots sociales para servir metadatos dinámicos
const SOCIAL_BOTS = [
  'facebookexternalhit',
  'twitterbot',
  'whatsapp',
  'telegrambot',
  'linkedinbot',
  'discordbot',
  'slackbot'
];

// Función para generar URL de imagen recortada (horizontal 16:9)
const generateCroppedImageUrl = (imageUrl) => {
  if (!imageUrl || imageUrl.includes('flaticon.com')) return imageUrl;
  // Si es una URL de Google Drive, generar una miniatura
  if (imageUrl.includes('drive.google.com')) {
    const match = imageUrl.match(/\/d\/([^/]+)/);
    if (match) {
      return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1200`;
    }
  }
  // Para otras URLs, agregar parámetros de redimensionamiento si es posible
  // Esto funciona con CDNs que soportan image resizing
  return imageUrl;
};

// Middleware para detectar bots y servir metadatos dinámicos de películas
const serveDynamicMetadata = async (req, res, next) => {
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isBot = SOCIAL_BOTS.some(bot => userAgent.includes(bot));
  const movieId = req.query.movie;

  // Solo procesar si hay un ID de película y es un bot o una ruta de película específica
  if (movieId && (isBot || req.path.includes('PeliPREX.html') || req.path === '/PeliPREX')) {
    try {
      if (!db) {
        return next();
      }

      // Buscar la película en Firestore por ID o título
      let movieData = null;
      const moviesRef = db.collection('peliculas');
      
      // Intentar buscar por ID primero
      const doc = await moviesRef.doc(movieId).get();
      if (doc.exists) {
        movieData = doc.data();
        movieData.id = doc.id;
      } else {
        // Si no existe por ID, intentar buscar por título (asumiendo que movieId puede ser el título)
        const querySnapshot = await moviesRef.where('titulo', '==', movieId).limit(1).get();
        if (!querySnapshot.empty) {
          movieData = querySnapshot.docs[0].data();
          movieData.id = querySnapshot.docs[0].id;
        }
      }

      if (movieData) {
        const title = `${movieData.titulo} - PeliPREX`;
        const description = (movieData.descripcion || `Ver ${movieData.titulo} en línea con la mejor calidad en PeliPREX.`).substring(0, 160);
        let imageUrl = generateCroppedImageUrl(movieData.imagen_url || 'https://cdn-icons-png.flaticon.com/128/747/747965.png');
        const pageUrl = `${HOST_URL}${req.path}?movie=${encodeURIComponent(movieId)}`;

        if (isBot) {
          // Servir HTML ligero solo con metadatos para bots
          const botHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <meta name="description" content="${description}">
    <meta property="og:type" content="video.movie">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:url" content="${pageUrl}">
    <meta property="og:site_name" content="PeliPREX HD">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${imageUrl}">
    <meta name="twitter:image:alt" content="${movieData.titulo}">
</head>
<body>
    <h1>${title}</h1>
    <p>${description}</p>
    <img src="${imageUrl}" alt="${title}">
</body>
</html>`;
          return res.send(botHtml);
        } else {
          // Para usuarios normales, inyectar los metadatos en el HTML original
          // Esto se manejará en el siguiente middleware serveHtmlWithGA para no duplicar lectura de archivos
          req.dynamicMetadata = {
            title,
            description,
            imageUrl,
            pageUrl,
            movieData
          };
        }
      }
    } catch (error) {
      logger.error('METADATA_BOT', `Error obteniendo metadatos para película ${movieId}`, error);
    }
  }
  next();
};

// Middleware para servir HTMLs con GA inyectado
const serveHtmlWithGA = (req, res, next) => {
  let fileName = '';
  if (req.path === '/') {
    fileName = 'home.html';
  } else if (PUBLIC_ROUTES.includes(req.path)) {
    fileName = `${req.path.substring(1)}.html`;
  } else if (req.path.endsWith('.html')) {
    fileName = req.path.substring(1);
  } else {
    // Verificar si existe el archivo con extensión .html
    const potentialFile = `${req.path.substring(1)}.html`;
    if (fs.existsSync(path.join(__dirname, 'public', potentialFile))) {
      fileName = potentialFile;
    }
  }

  if (fileName) {
    const filePath = path.join(__dirname, 'public', fileName);
    if (fs.existsSync(filePath)) {
      try {
        let html = fs.readFileSync(filePath, 'utf8');
        
        // Inyectar metadatos dinámicos si existen
        if (req.dynamicMetadata) {
          const { title, description, imageUrl, pageUrl } = req.dynamicMetadata;
          
          // Reemplazar título
          html = html.replace(/<title>.*?<\/title>/i, `<title>${title}</title>`);
          
          // Reemplazar o insertar meta descripción
          if (html.includes('name="description"')) {
            html = html.replace(/<meta name="description" content=".*?">/i, `<meta name="description" content="${description}">`);
          }

          // Inyectar etiquetas OG y Twitter (limpiando las existentes si las hay)
          const dynamicMetaTags = `
    <!-- Dynamic Open Graph -->
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:url" content="${pageUrl}" />
    <meta property="og:type" content="video.movie" />
    <meta property="og:site_name" content="PeliPREX HD" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta name="twitter:image:alt" content="${title}" />
          `;

          // Remover etiquetas OG existentes para evitar duplicados
          html = html.replace(/<meta property="og:title"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:description"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:image"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:image:width"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:image:height"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:image:type"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:url"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:type"[^>]*>/gi, '');
          html = html.replace(/<meta property="og:site_name"[^>]*>/gi, '');
          html = html.replace(/<meta name="twitter:card"[^>]*>/gi, '');
          html = html.replace(/<meta name="twitter:title"[^>]*>/gi, '');
          html = html.replace(/<meta name="twitter:description"[^>]*>/gi, '');
          html = html.replace(/<meta name="twitter:image"[^>]*>/gi, '');
          html = html.replace(/<meta name="twitter:image:alt"[^>]*>/gi, '');
          
          // Insertar después de <head>
          html = html.replace('<head>', `<head>${dynamicMetaTags}`);
        }

        // Inyectar script para actualizar metadatos en el cliente cuando se cargue la película
        const metadataScript = `
<script>
  // Datos de película inyectados desde el servidor
  window.injectedMovieData = ${JSON.stringify(req.dynamicMetadata?.movieData || {})};
  
  // Función para actualizar metadatos OG dinámicamente
  function updateOGTagsFromServer(movie) {
    if (!movie || !movie.titulo) return;
    
    const setMeta = (selector, attr, value) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        const parts = selector.match(/\[(\w+)="([^"]+)"\]/);
        if (parts) {
          el.setAttribute(parts[1], parts[2]);
          document.head.appendChild(el);
        }
      }
      if (el) el.setAttribute(attr, value);
    };
    
    const titulo = movie.titulo || '';
    const descripcion = (movie.descripcion || 'Ver en PeliPREX HD').substring(0, 160);
    const imagen = movie.imagen_url || 'https://cdn-icons-png.flaticon.com/128/747/747965.png';
    
    setMeta('meta[property="og:title"]', 'content', titulo + ' | PeliPREX HD');
    setMeta('meta[property="og:description"]', 'content', descripcion);
    setMeta('meta[property="og:image"]', 'content', imagen);
    setMeta('meta[property="og:image:width"]', 'content', '1200');
    setMeta('meta[property="og:image:height"]', 'content', '630');
    setMeta('meta[name="twitter:title"]', 'content', titulo + ' | PeliPREX HD');
    setMeta('meta[name="twitter:description"]', 'content', descripcion);
    setMeta('meta[name="twitter:image"]', 'content', imagen);
  }
  
  // Actualizar al cargar si hay datos inyectados
  if (window.injectedMovieData && window.injectedMovieData.titulo) {
    updateOGTagsFromServer(window.injectedMovieData);
  }
</script>
        `;
        
        // Insertar el script antes de cerrar </head>
        html = html.replace('</head>', metadataScript + '</head>');
        
        html = injectGA(html);
        return res.send(html);
      } catch (err) {
        logger.error('GA_INJECTION', `Error inyectando GA en ${fileName}`, err);
        return res.sendFile(filePath); // Fallback al archivo original
      }
    }
  }
  next();
};

app.use(serveDynamicMetadata);
app.use(serveHtmlWithGA);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get("/api", (req, res) => res.json({ status: "ok" }));

// Endpoint de Centro de Ayuda y Soporte
app.post("/api/support/send", async (req, res) => {
  const context = 'SUPPORT_SEND_API';
  try {
    const { name, email, subject, message, timestamp } = req.body;
    
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, error: 'Todos los campos son obligatorios' });
    }

    logger.info(context, 'Recibida nueva consulta de soporte', { email, subject });

    const result = await enviarCorreoSoporte({ name, email, subject, message, timestamp }, resend);

    if (result.success) {
      res.json({ success: true, message: 'Consulta enviada correctamente' });
    } else {
      res.status(500).json({ success: false, error: 'Error al enviar el correo de soporte' });
    }
  } catch (error) {
    logger.error(context, 'Error procesando envío de soporte', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Manejo de errores global
app.use((err, req, res, next) => {
  logger.error('GLOBAL_ERROR', 'Error no manejado', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  logger.info('SERVER', `🚀 Servidor iniciado en puerto ${PORT}`, { version: '3.6.0' });
});

app.get("*", (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
  const error404Path = path.join(__dirname, 'public', 'error-404.html');
  if (fs.existsSync(error404Path)) res.status(404).sendFile(error404Path);
  else res.status(404).send('404 - Página no encontrada');
});
