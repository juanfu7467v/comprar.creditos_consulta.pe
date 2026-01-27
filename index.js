import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { generateInvoicePDF } from './pdfGenerator.js';
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// --- Configuración de Firebase desde variables individuales ---
function buildServiceAccountFromEnv() {
  logger.info('FIREBASE_CONFIG', 'Construyendo service account desde variables de entorno individuales');
  
  // Verificar que todas las variables requeridas están presentes
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
    // Construir el objeto service account usando las variables individuales
    const serviceAccount = {
      "type": process.env.FIREBASE_TYPE || "service_account",
      "project_id": process.env.FIREBASE_PROJECT_ID,
      "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
      "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"), // Convertir \n a saltos de línea reales
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

// Inicializar Firebase
let db;
const serviceAccount = buildServiceAccountFromEnv();

if (serviceAccount && !admin.apps.length) {
  try {
    logger.info('FIREBASE', 'Inicializando Firebase Admin...');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
    });
    
    db = admin.firestore();
    
    // Configurar Firestore
    db.settings({
      ignoreUndefinedProperties: true
    });
    
    logger.info('FIREBASE', 'Firebase Admin inicializado correctamente', {
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email
    });
    
    // Verificar conexión a Firestore
    const firestoreCheck = await db.collection('_healthcheck').doc('connection').get()
      .then(() => ({ status: 'connected', message: 'Conexión a Firestore exitosa' }))
      .catch(error => ({ status: 'error', message: error.message }));
    
    logger.info('FIRESTORE', 'Verificación de conexión', firestoreCheck);
    
  } catch (error) {
    logger.error('FIREBASE', 'Error crítico al inicializar Firebase Admin', error, {
      projectId: serviceAccount?.project_id,
      clientEmail: serviceAccount?.client_email
    });
    
    // No salir del proceso, pero registrar el error
    console.error('CRITICAL: Firebase no pudo inicializarse. Algunas funciones no estarán disponibles.');
  }
} else if (admin.apps.length) {
  db = admin.firestore();
  logger.info('FIREBASE', 'Usando instancia existente de Firebase');
} else {
  logger.error('FIREBASE', 'No se pudo inicializar Firebase - Service account no disponible');
}

// --- Configuración de Mercado Pago ---
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const HOST_URL = process.env.HOST_URL || `https://${process.env.FLY_APP_NAME}.fly.dev`;

if (!MERCADOPAGO_ACCESS_TOKEN) {
  logger.error('CONFIG', 'MERCADOPAGO_ACCESS_TOKEN no está configurado');
  // No salimos del proceso para permitir otras funcionalidades
  console.warn('ADVERTENCIA: MERCADOPAGO_ACCESS_TOKEN no configurado. Pagos no disponibles.');
}

const mpClient = MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({ 
  accessToken: MERCADOPAGO_ACCESS_TOKEN.trim(),
  options: { timeout: 10000 }
}) : null;

const PAQUETES_CREDITOS = { 10: 60, 20: 125, 30: 200, 50: 330, 100: 700, 200: 1500 };
const PLANES_ILIMITADOS = { 60: 7, 80: 15, 110: 30, 160: 60, 510: 70 };

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

  const pagoDoc = db.collection("pagos_registrados").doc(paymentRef);
  
  try {
    const doc = await pagoDoc.get();
    
    if (doc.exists) {
      logger.warn(context, 'Pago ya procesado anteriormente (idempotencia)', { 
        uid, paymentRef, existingData: doc.data() 
      });
      return { status: 'already_processed', data: doc.data() };
    }

    logger.info(context, 'Procesando nuevo pago', { uid, email, montoPagado, processor, paymentRef });

    await pagoDoc.set({
      uid,
      email,
      monto: montoPagado,
      processor,
      fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
      estado: "approved",
      procesado: false // Flag para seguimiento
    });

    const userDoc = db.collection("usuarios").doc(uid);
    
    const result = await db.runTransaction(async (t) => {
      const user = await t.get(userDoc);
      if (!user.exists) {
        logger.error(context, 'Usuario no encontrado en Firestore', null, { uid });
        throw new Error(`User ${uid} not found`);
      }
      
      let descripcion = "";
      const montoNum = Number(montoPagado);
      let creditosOtorgados = 0;
      let planOtorgado = null;

      if (PAQUETES_CREDITOS[montoNum]) {
        creditosOtorgados = PAQUETES_CREDITOS[montoNum];
        const creditosActuales = user.data().creditos || 0;
        t.update(userDoc, { creditos: creditosActuales + creditosOtorgados });
        descripcion = `${creditosOtorgados} Créditos`;
        logger.info(context, 'Créditos otorgados', { uid, creditosOtorgados, montoPagado });
      } else if (PLANES_ILIMITADOS[montoNum]) {
        const dias = PLANES_ILIMITADOS[montoNum];
        const fin = moment().add(dias, 'days').toDate();
        t.update(userDoc, { planIlimitadoHasta: fin });
        planOtorgado = { dias, fechaFin: fin };
        descripcion = `Plan Ilimitado (${dias} días)`;
        logger.info(context, 'Plan ilimitado otorgado', { uid, dias, fechaFin: fin });
      } else {
        logger.warn(context, 'Monto no coincide con ningún paquete', { montoPagado, uid });
        descripcion = `Pago de S/ ${montoPagado}`;
      }
      
      // Actualizar documento de pago con descripción
      t.update(pagoDoc, { 
        descripcion,
        procesado: true,
        procesadoEn: admin.firestore.FieldValue.serverTimestamp(),
        creditosOtorgados,
        planOtorgado
      });
      
      return { 
        status: 'success', 
        creditosOtorgados, 
        planOtorgado,
        descripcion 
      };
    });

    logger.info(context, 'Transacción completada exitosamente', { uid, result });
    return result;

  } catch (error) {
    logger.error(context, 'Error en otorgarBeneficio', error, { uid, paymentRef, montoPagado });
    
    // Marcar el pago como fallido
    try {
      await pagoDoc.update({
        procesado: false,
        error: error.message,
        errorStack: error.stack,
        fallidoEn: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (updateError) {
      logger.error(context, 'Error al actualizar estado de fallo', updateError, { paymentRef });
    }
    
    return { status: 'error', message: error.message, error: error.stack };
  }
}

// --- API Endpoints ---

app.get("/api/config", (req, res) => {
  logger.info('API_CONFIG', 'Solicitud de configuración recibida');
  
  // Construir configuración de Firebase para el cliente
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
    firebaseConfig: firebaseClientConfig,
    environment: process.env.NODE_ENV || 'production',
    timestamp: new Date().toISOString()
  });
});

app.post("/api/pay", async (req, res) => {
  const context = 'PAYMENT_PROCESS';
  const startTime = Date.now();
  
  // Verificar si Mercado Pago está configurado
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

    logger.info(context, 'Iniciando procesamiento de pago', {
      uid, email, amount, payment_method_id, installments
    });

    // Validaciones
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

    // Si se aprueba al instante (tarjetas), activamos créditos inmediatamente
    if (result.status === 'approved') {
      logger.info(context, 'Pago aprobado instantáneamente, otorgando beneficios', {
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
      
      // Agregar información de créditos otorgados a la respuesta
      result.beneficioOtorgado = beneficioResult.status === 'success';
      if (beneficioResult.creditosOtorgados) {
        result.creditosOtorgados = beneficioResult.creditosOtorgados;
      }
    } else {
      logger.info(context, 'Pago no aprobado instantáneamente', {
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

    // Proporcionar un mensaje de error detallado
    let errorMessage = 'Error procesando el pago';
    let errorDetails = {};
    
    if (error.api_response?.body) {
      errorDetails = error.api_response.body;
      errorMessage = errorDetails.message || errorMessage;
      
      // Log específico de errores de Mercado Pago
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

app.post("/api/webhook/mercadopago", async (req, res) => {
  const context = 'WEBHOOK_MP';
  const webhookData = req.body;
  
  logger.info(context, 'Webhook recibido', {
    action: webhookData.action,
    type: webhookData.type,
    id: webhookData.data?.id,
    receivedAt: new Date().toISOString()
  });

  // Verificar si Mercado Pago está configurado
  if (!mpClient) {
    logger.error(context, 'Mercado Pago no configurado, ignorando webhook');
    return res.sendStatus(200); // Siempre responder 200 a MP
  }

  // Escuchar tanto formato nuevo como antiguo
  const isPaymentEvent = webhookData.action?.includes('payment') || webhookData.type === 'payment';
  
  if (isPaymentEvent) {
    try {
      const paymentId = webhookData.data?.id || webhookData.data?.id;
      
      if (!paymentId) {
        logger.error(context, 'Payment ID no encontrado en webhook', null, webhookData);
        return res.sendStatus(200); // Siempre responder 200 a MP
      }

      logger.info(context, 'Consultando información del pago', { paymentId });

      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      logger.info(context, 'Información del pago obtenida', {
        paymentId,
        status: paymentInfo.status,
        statusDetail: paymentInfo.status_detail
      });

      if (paymentInfo.status === "approved") {
        // Leer metadatos con fallbacks
        const metadata = paymentInfo.metadata || {};
        const uid = metadata.uid;
        const email = metadata.email || paymentInfo.payer?.email;
        const amount = metadata.amount || paymentInfo.transaction_amount;

        if (uid) {
          logger.info(context, 'Procesando pago aprobado via webhook', {
            paymentId, uid, email, amount
          });

          const beneficioResult = await otorgarBeneficio(
            uid,
            email,
            Number(amount),
            'MP_WEBHOOK',
            paymentId.toString()
          );

          logger.info(context, 'Resultado del webhook', {
            paymentId,
            uid,
            beneficioStatus: beneficioResult.status,
            message: beneficioResult.message
          });

        } else {
          logger.error(context, 'UID no encontrado en metadatos del pago', null, {
            paymentId,
            metadata,
            payer: paymentInfo.payer
          });
        }
      } else {
        logger.info(context, 'Pago no está aprobado, ignorando', {
          paymentId,
          status: paymentInfo.status
        });
      }

    } catch (error) {
      logger.error(context, 'Error procesando webhook', error, {
        paymentId: webhookData.data?.id,
        action: webhookData.action
      });
    }
  } else {
    logger.info(context, 'Evento no relevante ignorado', {
      action: webhookData.action,
      type: webhookData.type
    });
  }

  // IMPORTANTE: Siempre responder 200 a Mercado Pago
  res.sendStatus(200);
});

// Nuevo endpoint para generar comprobante
app.post("/api/generate-invoice", async (req, res) => {
  const context = 'GENERATE_INVOICE';
  
  try {
    const { paymentId, type = 'boleta', ruc, razonSocial, email } = req.body;
    
    if (!paymentId) {
      logger.error(context, 'Payment ID requerido', null, req.body);
      return res.status(400).json({ error: 'Payment ID es requerido' });
    }

    logger.info(context, 'Generando comprobante', { paymentId, type });

    // En una implementación real, aquí buscarías los datos del pago desde tu DB
    // Por ahora usamos datos de ejemplo
    const invoiceData = {
      orderId: paymentId,
      date: new Date().toLocaleString('es-PE'),
      email: email || 'cliente@example.com',
      amount: req.body.amount || 10,
      credits: req.body.credits || 60,
      description: req.body.description || 'Créditos Consulta PE',
      type: type,
      ruc: ruc || '',
      razonSocial: razonSocial || ''
    };

    const pdfUrl = await generateInvoicePDF(invoiceData);
    
    logger.info(context, 'Comprobante generado exitosamente', {
      paymentId,
      pdfUrl,
      type
    });

    res.json({
      success: true,
      pdfUrl: `${HOST_URL}${pdfUrl}`,
      downloadUrl: `${HOST_URL}${pdfUrl}?download=true`,
      message: 'Comprobante generado exitosamente'
    });

  } catch (error) {
    logger.error(context, 'Error generando comprobante', error, req.body);
    res.status(500).json({
      error: 'Error generando comprobante',
      details: error.message
    });
  }
});

// Endpoint para obtener opciones de facturación
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

// Health check endpoint mejorado
app.get("/api/health", async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      mercadopago: !!MERCADOPAGO_ACCESS_TOKEN,
      firebase: !!db,
      firebaseInitialized: !!admin.apps.length,
      pdfGenerator: true
    },
    environment: process.env.NODE_ENV || 'development',
    hostUrl: HOST_URL,
    flyAppName: process.env.FLY_APP_NAME,
    firebaseProject: process.env.FIREBASE_PROJECT_ID
  };
  
  // Verificar Firebase más profundamente si está inicializado
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

// Endpoint para verificar configuración de Firebase
app.get("/api/debug/firebase", (req, res) => {
  const firebaseVars = {
    FIREBASE_TYPE: process.env.FIREBASE_TYPE ? '✓' : '✗',
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ? '✓' : '✗',
    FIREBASE_PRIVATE_KEY_ID: process.env.FIREBASE_PRIVATE_KEY_ID ? '✓' : '✗',
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? '✓ (length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : '✗',
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ? '✓' : '✗',
    FIREBASE_CLIENT_ID: process.env.FIREBASE_CLIENT_ID ? '✓' : '✗',
    FIREBASE_CLIENT_X509_CERT_URL: process.env.FIREBASE_CLIENT_X509_CERT_URL ? '✓' : '✗'
  };
  
  const missingVars = Object.entries(firebaseVars)
    .filter(([key, value]) => value === '✗')
    .map(([key]) => key);
  
  res.json({
    firebaseVars,
    missingVars,
    adminInitialized: !!admin.apps.length,
    firestoreAvailable: !!db,
    timestamp: new Date().toISOString()
  });
});

// Manejo de errores global
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

// Ruta de inicio
app.get("/", (req, res) => {
  res.json({
    message: "API de Pagos Consulta PE",
    version: "1.0.0",
    endpoints: {
      config: "/api/config",
      pay: "/api/pay",
      health: "/api/health",
      webhook: "/api/webhook/mercadopago",
      invoice: "/api/generate-invoice",
      debug: "/api/debug/firebase"
    },
    status: "online",
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  logger.info('SERVER', `Servidor iniciado en puerto ${PORT}`, {
    hostUrl: HOST_URL,
    nodeEnv: process.env.NODE_ENV,
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    timestamp: new Date().toISOString()
  });
});
