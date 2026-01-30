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

// Inicializar Firebase
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

// --- Configuración de Mercado Pago ---
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

// Cache en memoria para idempotencia inmediata
const processedPaymentsCache = new Map();

// Mutex para evitar race conditions
const paymentLocks = new Map();

/**
 * Función para adquirir lock de procesamiento
 * Previene que el mismo pago se procese simultáneamente
 */
async function acquirePaymentLock(paymentRef, maxWaitMs = 10000) {
  const context = 'PAYMENT_LOCK';
  const startTime = Date.now();
  
  while (paymentLocks.has(paymentRef)) {
    if (Date.now() - startTime > maxWaitMs) {
      logger.warn(context, 'Timeout esperando lock', { paymentRef, waitedMs: maxWaitMs });
      return false;
    }
    // Esperar 100ms antes de reintentar
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  paymentLocks.set(paymentRef, Date.now());
  logger.info(context, '🔒 Lock adquirido', { paymentRef });
  return true;
}

/**
 * Función para liberar lock de procesamiento
 */
function releasePaymentLock(paymentRef) {
  const context = 'PAYMENT_LOCK';
  paymentLocks.delete(paymentRef);
  logger.info(context, '🔓 Lock liberado', { paymentRef });
}

/**
 * 🆕 FUNCIÓN MEJORADA: Verificar si archivo ya existe en Storage
 * SOLUCIÓN PROBLEMA 1: Evita duplicación verificando antes de subir
 */
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
      // Obtener URL pública
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

/**
 * 🆕 FUNCIÓN MEJORADA: Subir PDF a Firebase Storage con idempotencia
 * SOLUCIÓN PROBLEMA 1: Verifica existencia antes de subir
 * SOLUCIÓN PROBLEMA 2: Configura metadata correcta para descarga
 */
async function uploadPDFToStorage(pdfPath, paymentId) {
  const context = 'UPLOAD_PDF';
  
  if (!bucket) {
    logger.error(context, 'Firebase Storage no está inicializado');
    throw new Error('Firebase Storage not initialized');
  }
  
  try {
    logger.info(context, 'Intentando subir PDF a Firebase Storage', { pdfPath, paymentId });
    
    // 🔴 CORRECCIÓN: Usar nombre estático sin timestamp
    const fileName = `invoices/${paymentId}.pdf`;
    
    // 🔴 CORRECCIÓN: Verificar si el archivo ya existe antes de subir
    const fileCheck = await checkFileExistsInStorage(fileName);
    if (fileCheck.exists && fileCheck.url) {
      logger.info(context, '📁 PDF ya existe en Storage, devolviendo URL existente', { 
        paymentId, 
        url: fileCheck.url 
      });
      return fileCheck.url;
    }
    
    const file = bucket.file(fileName);
    
    await bucket.upload(pdfPath, {
      destination: fileName,
      metadata: {
        // 🔴 CORRECCIÓN: Metadata esencial para descarga forzada
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="Boleta_ConsultaPE.pdf"',
        metadata: {
          paymentId: paymentId,
          uploadedAt: new Date().toISOString(),
          type: 'boleta_electronica'
        }
      }
    });
    
    // Hacer el archivo público
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

/**
 * Función principal corregida con idempotencia robusta
 */
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
  
  // Verificar cache de memoria primero (respuesta instantánea)
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

  // Adquirir lock para evitar procesamiento simultáneo
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
    // Verificar en Firestore antes de procesar
    const doc = await pagoDoc.get();
    
    if (doc.exists) {
      const existingData = doc.data();
      
      // Verificar si ya fue procesado exitosamente
      if (existingData.procesado === true && existingData.estado === "approved") {
        logger.warn(context, '🚫 Pago ya procesado anteriormente en Firestore (idempotencia)', { 
          uid, 
          paymentRef: paymentRefString, 
          procesadoEn: existingData.procesadoEn?.toDate?.() || existingData.procesadoEn,
          processor: existingData.procesadoPor,
          pdfUrl: existingData.pdfUrl || null
        });
        
        // Agregar a cache para futuras verificaciones
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

    // Crear documento con estado "procesando" para evitar condiciones de carrera
    await pagoDoc.set({
      uid,
      email,
      monto: montoPagado,
      processor,
      fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
      estado: "processing", // Marca como "procesando"
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
      
      // Obtener datos actuales del usuario
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

      // CASO 1: Compra de créditos
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
        
      // CASO 2: Compra de plan ilimitado
      } else if (PLANES_ILIMITADOS[montoNum]) {
        const diasNuevos = PLANES_ILIMITADOS[montoNum];
        let duracionTotalDias;
        let fechaFinPlan;
        let fechaActivacion;
        
        // Verificar si ya tiene plan ilimitado ACTIVO
        const ahora = new Date();
        const tienePlanIlimitadoActivo = tipoPlanActual === "ilimitado" && 
                                          fechaActivacionActual && 
                                          planIlimitadoHastaActual &&
                                          planIlimitadoHastaActual.toDate() > ahora;
        
        if (tienePlanIlimitadoActivo) {
          // Acumular días desde la fecha de activación original
          fechaActivacion = fechaActivacionActual.toDate();
          duracionTotalDias = duracionDiasActual + diasNuevos;
          
          // Calcular nueva fecha fin: fechaActivacion + duracionTotalDias
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
          // Crear nuevo plan ilimitado o renovar uno vencido
          fechaActivacion = ahora;
          duracionTotalDias = diasNuevos;
          fechaFinPlan = moment(ahora).add(diasNuevos, 'days').toDate();
          
          logger.info(context, '🆕 Creando nuevo plan ilimitado', {
            uid,
            diasNuevos,
            fechaInicio: fechaActivacion.toISOString(),
            fechaFin: fechaFinPlan.toISOString(),
            razon: tienePlanIlimitadoActivo ? 'nuevo_plan' : 'plan_vencido_o_inexistente'
          });
        }
        
        // Actualizar con duración total acumulada
        t.update(userDoc, { 
          duracionDias: duracionTotalDias, // ✅ Guardar duración total acumulada
          planIlimitadoHasta: fechaFinPlan,
          creditos: 0, // Resetear créditos al tener plan ilimitado
          tipoPlan: "ilimitado",
          fechaActivacion: tienePlanIlimitadoActivo 
            ? fechaActivacionActual // ✅ Mantener fecha original si ya tenía plan activo
            : admin.firestore.FieldValue.serverTimestamp(), // Nueva fecha si es primera compra o plan vencido
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
      
      // Marcar pago como procesado exitosamente
      t.update(pagoDoc, { 
        descripcion,
        procesado: true, // ✅ Marcar como procesado
        estado: "approved", // Estado final
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

    // 🔴 NUEVO: Generar y subir PDF a Firebase Storage automáticamente (Solo Boletas)
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
      
      // Subir PDF a Firebase Storage (función mejorada con idempotencia)
      const storageUrl = await uploadPDFToStorage(localPdfPath, paymentRefString);
      
      // Guardar URL del PDF en el documento del pago
      await pagoDoc.update({
        pdfUrl: storageUrl,
        pdfGeneradoEn: admin.firestore.FieldValue.serverTimestamp(),
        tipoComprobante: 'boleta',
        storagePath: `invoices/${paymentRefString}.pdf`
      });
      
      // Eliminar archivo local inmediatamente
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
      // No fallar la transacción completa si falla el PDF
    }

    // Agregar a cache después de procesamiento exitoso
    processedPaymentsCache.set(paymentRefString, {
      uid,
      timestamp: new Date().toISOString(),
      processor,
      status: 'processed',
      pdfUrl: result.pdfUrl || null
    });
    
    // Limpiar cache después de 2 horas para ahorrar memoria
    setTimeout(() => {
      processedPaymentsCache.delete(paymentRefString);
      logger.info(context, '🧹 Pago removido del cache', { paymentRef: paymentRefString });
    }, 2 * 60 * 60 * 1000);
    
    logger.info(context, '✅ Transacción completada exitosamente', { uid, result });
    
    // Liberar lock
    releasePaymentLock(paymentRefString);
    
    return result;

  } catch (error) {
    logger.error(context, '❌ Error en otorgarBeneficio', error, { uid, paymentRef: paymentRefString, montoPagado });
    
    // Marcar el pago como fallido pero NO procesado
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
    
    // Liberar lock
    releasePaymentLock(paymentRefString);
    
    return { status: 'error', message: error.message, error: error.stack };
  }
}

// --- API Endpoints ---

app.get("/api/config", (req, res) => {
  logger.info('API_CONFIG', 'Solicitud de configuración recibida');
  
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

    // Solo procesar si está aprobado instantáneamente
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

// Webhook mejorado con mejor manejo de idempotencia
app.post("/api/webhook/mercadopago", async (req, res) => {
  const context = 'WEBHOOK_MP';
  const webhookData = req.body;
  
  logger.info(context, '📩 Webhook recibido', {
    action: webhookData.action,
    type: webhookData.type,
    id: webhookData.data?.id,
    receivedAt: new Date().toISOString()
  });

  // ✅ Responder inmediatamente a Mercado Pago (200 OK) para evitar reintentos
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
    logger.info(context, 'ℹ️ Evento no relevante ignorado', {
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
    
    // Formatear fecha
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

/**
 * 🔴 ENDPOINT CRÍTICO MEJORADO: generate-invoice
 * SOLUCIÓN PROBLEMA 1: Verifica existencia antes de generar
 * SOLUCIÓN PROBLEMA 2: Responde inmediatamente si ya existe
 */
app.post("/api/generate-invoice", async (req, res) => {
  const context = 'GENERATE_INVOICE';
  
  try {
    // Solo Boletas (SUNAT Nuevo RUS)
    const { 
      paymentId, 
      email,
      amount,
      credits,
      description,
      clientName, // Opcional si < 700
      type = 'boleta'
    } = req.body;
    
    if (!paymentId) {
      logger.error(context, 'Payment ID requerido', null, req.body);
      return res.status(400).json({ error: 'Payment ID es requerido' });
    }

    logger.info(context, 'Solicitud para generar boleta electrónica', { paymentId });

    // 🔴 SOLUCIÓN 1: Verificar si ya existe un PDF para este pago en Firestore
    let existingPdfUrl = null;
    let responseSent = false;
    
    if (db) {
      try {
        const doc = await db.collection("pagos_registrados").doc(String(paymentId)).get();
        if (doc.exists) {
          const pagoData = doc.data();
          
          // Verificar si ya tiene PDF URL
          if (pagoData.pdfUrl) {
            existingPdfUrl = pagoData.pdfUrl;
            logger.info(context, '✅ PDF ya existe en datos del pago', { 
              paymentId, 
              pdfUrl: existingPdfUrl,
              storagePath: pagoData.storagePath || 'N/A'
            });
            
            // 🔴 SOLUCIÓN 2: Responder inmediatamente con URL existente
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
        // Continuar con la generación si hay error en la consulta
      }
    }

    // Si ya respondimos, salir
    if (responseSent) return;

    // 🔴 SOLUCIÓN 1: Verificar directamente en Storage
    const fileName = `invoices/${paymentId}.pdf`;
    const storageCheck = await checkFileExistsInStorage(fileName);
    
    if (storageCheck.exists && storageCheck.url) {
      logger.info(context, '✅ PDF ya existe en Storage', { 
        paymentId, 
        url: storageCheck.url 
      });
      
      // Actualizar Firestore con la URL
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
    
    // Subir PDF a Firebase Storage (función idempotente)
    let storageUrl = null;
    try {
      storageUrl = await uploadPDFToStorage(localPdfPath, paymentId);
      
      // Actualizar documento del pago con la URL del PDF
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
      
      // Eliminar archivo local inmediatamente
      if (fs.existsSync(localPdfPath)) {
        fs.unlinkSync(localPdfPath);
      }
    } catch (uploadError) {
      logger.error(context, 'Error subiendo PDF a Storage', uploadError);
      // Si falla el upload, devolver la URL local como fallback
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
      firebaseStorage: !!bucket,
      firebaseInitialized: !!admin.apps.length,
      pdfGenerator: true
    },
    environment: process.env.NODE_ENV || 'development',
    hostUrl: HOST_URL,
    flyAppName: process.env.FLY_APP_NAME,
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    processedPaymentsCacheSize: processedPaymentsCache.size,
    activePaymentLocks: paymentLocks.size,
    duplicatePrevention: {
      memoryCache: true,
      firestoreCheck: true,
      storageCheck: true,
      fileLocks: true
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

// Endpoint para verificar configuración de Firebase
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
    timestamp: new Date().toISOString()
  });
});

// Endpoint para limpiar cache manualmente (útil para debugging)
app.post("/api/admin/clear-cache", (req, res) => {
  const context = 'ADMIN_CLEAR_CACHE';
  
  try {
    const cacheSize = processedPaymentsCache.size;
    const locksSize = paymentLocks.size;
    
    processedPaymentsCache.clear();
    paymentLocks.clear();
    
    logger.info(context, '🧹 Cache limpiado manualmente', {
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
    version: "2.2.0 - Firebase Storage Duplication Fix + Forced Download",
    endpoints: {
      config: "/api/config",
      pay: "/api/pay",
      health: "/api/health",
      webhook: "/api/webhook/mercadopago",
      invoice: "/api/generate-invoice",
      paymentInfo: "/api/payment/:paymentId",
      debug: "/api/debug/firebase",
      clearCache: "/api/admin/clear-cache"
    },
    fixes: {
      duplicateFiles: "✅ Fixed - Idempotency in Storage upload",
      forcedDownload: "✅ Fixed - contentDisposition metadata",
      instantResponse: "✅ Fixed - Immediate response for existing files",
      pdfGeneration: "✅ Fixed - Check before generate"
    },
    status: "online",
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  logger.info('SERVER', `🚀 Servidor iniciado en puerto ${PORT}`, {
    hostUrl: HOST_URL,
    nodeEnv: process.env.NODE_ENV,
    firebaseProject: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    version: '2.2.0',
    features: 'Storage duplication fix + Forced download metadata + Idempotent PDF generation',
    timestamp: new Date().toISOString()
  });
});
