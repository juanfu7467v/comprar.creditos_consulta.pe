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
          updateData.creditos = 0;
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
          await db.collection("usuarios").doc(uid).set({ creditos: 0, tipoPlan: "creditos" }, { merge: true });
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
      return res.json({ success: result.success, message: result.success ? 'Email sent' : 'Error sending email' });
    }
    res.json({ success: true, message: 'Already sent' });
  } catch (error) {
    logger.error(context, 'Error en notify-verification', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Endpoint para obtener configuración (reemplaza returnConfig.js en el cliente)
app.get("/api/config", (req, res) => {
  res.json(ReturnConfigServer);
});

// ================================================================
// 🔍 SISTEMA DE METADATOS DINÁMICOS (SEO & SOCIAL)
// ================================================================

const PUBLIC_ROUTES = [
  '/home', '/PeliPREX', '/actividad', '/favoritos', '/historial', '/planes', 
  '/checkout', '/verificacion', '/login', '/recuperar-cuenta', '/ayuda',
  '/politica', '/terminos-condiciones', '/aviso-legal-peliprex'
];

const injectGA = (html) => {
  const gaScript = `
    <!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-XXXXXXXXXX', {
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

// Middleware para detectar bots y servir metadatos dinámicos de películas
const serveDynamicMetadata = async (req, res, next) => {
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isBot = SOCIAL_BOTS.some(bot => userAgent.includes(bot));
  const movieId = req.query.movie;

  // Solo procesar si hay un ID de película y es un bot o una ruta de película específica
  if (movieId && (isBot || req.path.includes('PeliPREX.html') || req.path === '/PeliPREX' || req.path === '/actividad' || req.path === '/favoritos' || req.path === '/historial')) {
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
        const description = movieData.descripcion || `Ver ${movieData.titulo} en línea con la mejor calidad en PeliPREX.`;
        
        // Optimización de Imagen: Intentar usar backdrop si existe, o usar un proxy para forzar dimensiones si es posible
        // Como no tenemos procesamiento local, usaremos la imagen_url pero con metadatos de dimensiones correctos
        let imageUrl = movieData.imagen_url || 'https://cdn-icons-png.flaticon.com/128/747/747965.png';
        
        // Si es una URL de TMDB, podemos intentar obtener la versión horizontal (backdrop) si conocemos el patrón
        // Por ahora aseguramos que la URL sea absoluta y segura
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        
        const pageUrl = `${HOST_URL}${req.path}?movie=${encodeURIComponent(movieId)}`;

        const metaTags = `
    <title>${title}</title>
    <meta name="description" content="${description}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:secure_url" content="${imageUrl}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:url" content="${pageUrl}">
    <meta property="og:type" content="video.movie">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${imageUrl}">`;

        if (isBot) {
          // Servir HTML ligero solo con metadatos para bots
          const botHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">${metaTags}</head><body><h1>${title}</h1><p>${description}</p><img src="${imageUrl}"></body></html>`;
          return res.send(botHtml);
        } else {
          // Para usuarios normales, inyectar los metadatos en el HTML original
          req.dynamicMetadata = {
            title,
            description,
            imageUrl,
            pageUrl,
            metaTags
          };
        }
      }
    } catch (error) {
      logger.error('DYNAMIC_METADATA', 'Error obteniendo metadatos', error);
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
          const { metaTags } = req.dynamicMetadata;
          
          // Eliminar etiquetas estáticas existentes para evitar duplicados y conflictos
          html = html.replace(/<title>.*?<\/title>/i, '');
          html = html.replace(/<meta name="description" content=".*?">/i, '');
          html = html.replace(/<meta property="og:.*?" content=".*?">/gi, '');
          html = html.replace(/<meta property="og:.*?" \/>/gi, '');
          html = html.replace(/<meta name="twitter:.*?" content=".*?">/gi, '');

          // Inyectar las nuevas etiquetas al INICIO absoluto del head
          html = html.replace('<head>', `<head>${metaTags}`);
        }

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
