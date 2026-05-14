import admin from "firebase-admin";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { generateInvoicePDF } from './pdfGenerator.js';
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import moment from "moment-timezone";
import { logger } from './seguridad.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================================================================
// 🔥 CONFIGURACIÓN DE FIREBASE
// ================================================================

export function buildServiceAccountFromEnv() {
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

export let db;
export let bucket;

export async function initFirebase(serviceAccount) {
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

      // Verificación asíncrona (sin await para no bloquear el arranque)
      db.collection('_healthcheck').doc('connection').get()
        .then(() => logger.info('FIRESTORE', 'Conexión a Firestore exitosa'))
        .catch(error => logger.error('FIRESTORE', 'Error verificando conexión', error));

    } catch (error) {
      logger.error('FIREBASE', 'Error crítico al inicializar Firebase Admin', error, {
        projectId: serviceAccount?.project_id,
        clientEmail: serviceAccount?.client_email
      });
      console.error('CRITICAL: Firebase no pudo inicializarse.');
    }
  } else if (admin.apps.length) {
    db = admin.firestore();
    bucket = admin.storage().bucket();
    logger.info('FIREBASE', 'Usando instancia existente de Firebase');
  }
}

// ================================================================
// 💳 CONFIGURACIÓN DE MERCADO PAGO Y MAPA DE PRECIOS SEGURO
// ================================================================

// Mapa de Precios Seguro (Backend)
export const MAPA_PLANES = {
  // Paquetes de Créditos
  "60_creditos": { precio: 10, creditos: 60, bonus: 3, tipo: "creditos", descripcion: "Paquete de 60 créditos + 3 bonus" },
  "125_creditos": { precio: 20, creditos: 125, bonus: 5, tipo: "creditos", descripcion: "Paquete de 125 créditos + 5 bonus" },
  "330_creditos": { precio: 50, creditos: 330, bonus: 20, tipo: "creditos", descripcion: "Paquete de 330 créditos + 20 bonus" },
  "700_creditos": { precio: 100, creditos: 700, bonus: 40, tipo: "creditos", descripcion: "Paquete de 700 créditos + 40 bonus" },
  "1500_creditos": { precio: 200, creditos: 1500, bonus: 80, tipo: "creditos", descripcion: "Paquete de 1500 créditos + 80 bonus" },
  
  // Planes Intensivos (Ilimitados)
  "plan_7_dias": { precio: 80, dias: 7, umbral: 1000, tipo: "ilimitado", descripcion: "Plan Intensivo 7 días (1,000 consultas)" },
  "plan_15_dias": { precio: 120, dias: 15, umbral: 2500, tipo: "ilimitado", descripcion: "Plan Intensivo 15 días (2,500 consultas)" },
  "plan_30_dias": { precio: 180, dias: 30, umbral: 5000, tipo: "ilimitado", descripcion: "Plan Intensivo 30 días (5,000 consultas)" },
  "plan_60_dias": { precio: 320, dias: 60, umbral: 12000, tipo: "ilimitado", descripcion: "Plan Intensivo 60 días (12,000 consultas)" },

  // Revenue Recovery (Mantener compatibilidad si existe)
  "plan_starter_rr": { precio: 29, dias: 30, tipo: "revenue_recovery", descripcion: "Plan Starter - Revenue Recovery OS" },
  "plan_business_rr": { precio: 79, dias: 30, tipo: "revenue_recovery", descripcion: "Plan Business - Revenue Recovery OS" },
  "plan_enterprise_rr": { precio: 199, dias: 30, tipo: "revenue_recovery", descripcion: "Plan Enterprise - Revenue Recovery OS" }
};

// Mantener para compatibilidad con código antiguo si es necesario, pero priorizar MAPA_PLANES
export const PAQUETES_CREDITOS = { 10: 60, 20: 125, 50: 330, 100: 700, 200: 1500 };
export const PLANES_ILIMITADOS = { 80: 7, 120: 15, 180: 30, 320: 60 };

export const processedPaymentsCache = new Map();
export const paymentLocks = new Map();

export async function acquirePaymentLock(paymentRef, maxWaitMs = 10000) {
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

export function releasePaymentLock(paymentRef) {
  const context = 'PAYMENT_LOCK';
  paymentLocks.delete(paymentRef);
  logger.info(context, '🔓 Lock liberado', { paymentRef });
}

export async function checkFileExistsInStorage(fileName) {
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

export async function uploadPDFToStorage(pdfPath, paymentId) {
  const context = 'STORAGE_UPLOAD';

  if (!bucket) {
    logger.error(context, 'Firebase Storage no está inicializado');
    return null;
  }

  try {
    const fileName = `invoices/${paymentId}.pdf`;
    
    const [file] = await bucket.upload(pdfPath, {
      destination: fileName,
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          paymentId: paymentId,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    
    logger.info(context, '✅ PDF subido exitosamente a Storage', { fileName, publicUrl });
    return publicUrl;

  } catch (error) {
    logger.error(context, '❌ Error subiendo PDF a Storage', error, { paymentId });
    return null;
  }
}

/**
 * Otorgar beneficios al usuario tras un pago exitoso
 * Ahora valida contra el planId y el mapa de precios seguro
 */
export async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRefString, resend, planId) {
  const context = 'OTORGAR_BENEFICIO';
  
  if (!db) {
    logger.error(context, 'Base de datos no disponible');
    return { status: 'error', message: 'Database not available' };
  }

  // Validación de Plan
  const planSeguro = MAPA_PLANES[planId];
  if (!planSeguro) {
    logger.error(context, 'PlanId no válido', { planId, uid });
    return { status: 'error', message: 'Invalid Plan ID' };
  }

  // Validación de Monto (Seguridad)
  const montoNum = Number(montoPagado);
  if (Math.abs(montoNum - planSeguro.precio) > 0.01) {
    logger.error(context, 'DISCREPANCIA DE MONTO DETECTADA', { 
      planId, 
      montoPagado: montoNum, 
      precioEsperado: planSeguro.precio,
      uid 
    });
    return { status: 'error', message: 'Payment amount mismatch' };
  }

  try {
    const lockAcquired = await acquirePaymentLock(paymentRefString);
    if (!lockAcquired) {
      return { status: 'error', message: 'Could not acquire payment lock' };
    }

    if (processedPaymentsCache.has(paymentRefString)) {
      const cached = processedPaymentsCache.get(paymentRefString);
      logger.info(context, 'Pago ya procesado (Cache)', { paymentRef: paymentRefString, uid: cached.uid });
      releasePaymentLock(paymentRefString);
      return { status: 'already_processed', ...cached };
    }

    const pagoDoc = db.collection("pagos_registrados").doc(paymentRefString);
    const pagoSnap = await pagoDoc.get();

    if (pagoSnap.exists && pagoSnap.data().procesado) {
      logger.info(context, 'Pago ya procesado (Firestore)', { paymentRef: paymentRefString });
      releasePaymentLock(paymentRefString);
      return { status: 'already_processed', pdfUrl: pagoSnap.data().pdfUrl };
    }

    if (!pagoSnap.exists) {
      logger.info(context, 'Creando documento de pago inicial', { paymentRef: paymentRefString });
      await pagoDoc.set({
        email: email,
        monto: montoNum,
        uid: uid,
        planId: planId,
        estado: "pending",
        procesado: false,
        fechaRegistro: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    const result = await db.runTransaction(async (t) => {
      const userDoc = db.collection("usuarios").doc(uid);
      const userSnap = await t.get(userDoc);

      if (!userSnap.exists) {
        logger.warn(context, 'Usuario no encontrado en colección usuarios, buscando en empresas', { uid });
        const empresaDoc = await t.get(db.collection("empresas").doc(uid));
        if (!empresaDoc.exists) {
          throw new Error(`Usuario ${uid} no encontrado en ninguna colección`);
        }
      }

      const userData = userSnap.data() || {};
      const creditosActuales = userData.creditos || 0;
      const tipoPlanActual = userData.tipoPlan || "creditos";
      const fechaActivacionActual = userData.fechaActivacion;
      const planIlimitadoHastaActual = userData.planIlimitadoHasta;
      const duracionDiasActual = userData.duracionDias || 0;

      let creditosOtorgados = 0;
      let descripcion = planSeguro.descripcion;
      let planOtorgado = null;

      // 1. Lógica para Revenue Recovery OS
      if (planSeguro.tipo === 'revenue_recovery') {
        const diasNuevos = planSeguro.dias;
        const ahora = new Date();
        const fechaFinPlan = moment(ahora).add(diasNuevos, 'days').toDate();
        const planName = planSeguro.descripcion.split(' - ')[0];

        // Actualizar colección empresas (Revenue Recovery)
        const empresaRef = db.collection("empresas").doc(uid);
        t.set(empresaRef, {
          plan: planName,
          planStatus: 'active',
          planExpiry: fechaFinPlan,
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        planOtorgado = { dias: diasNuevos, fechaFin: fechaFinPlan, planName };

        t.update(pagoDoc, {
          descripcion,
          procesado: true,
          estado: "approved",
          procesadoEn: admin.firestore.FieldValue.serverTimestamp(),
          procesadoPor: processor,
          planOtorgado,
          tipoPlanNuevo: "revenue_recovery"
        });

        return {
          status: 'success',
          planOtorgado,
          descripcion,
          tipoPlanNuevo: "revenue_recovery"
        };
      }

      // 2. Lógica para Créditos
      if (planSeguro.tipo === 'creditos') {
        creditosOtorgados = planSeguro.creditos + (planSeguro.bonus || 0);
        const nuevosCreditos = creditosActuales + creditosOtorgados;

        t.update(userDoc, {
          creditos: nuevosCreditos,
          tipoPlan: "creditos",
          ultimaCompra: admin.firestore.FieldValue.serverTimestamp()
        });

        t.update(pagoDoc, {
          descripcion,
          procesado: true,
          estado: "approved",
          procesadoEn: admin.firestore.FieldValue.serverTimestamp(),
          procesadoPor: processor,
          creditosOtorgados,
          creditosAnteriores: creditosActuales,
          creditosNuevos: nuevosCreditos,
          tipoPlanNuevo: "creditos"
        });

        return {
          status: 'success',
          creditosOtorgados,
          creditosAnteriores: creditosActuales,
          creditosNuevos: nuevosCreditos,
          descripcion,
          tipoPlanNuevo: "creditos"
        };

      } 
      
      // 3. Lógica para Planes Ilimitados
      if (planSeguro.tipo === 'ilimitado') {
        const diasNuevos = planSeguro.dias;
        let duracionTotalDias;
        let fechaFinPlan;
        const ahora = new Date();

        const tienePlanIlimitadoActivo = tipoPlanActual === "ilimitado" &&
          fechaActivacionActual &&
          planIlimitadoHastaActual &&
          planIlimitadoHastaActual.toDate() > ahora;

        if (tienePlanIlimitadoActivo) {
          duracionTotalDias = duracionDiasActual + diasNuevos;
          fechaFinPlan = moment(fechaActivacionActual.toDate()).add(duracionTotalDias, 'days').toDate();
        } else {
          duracionTotalDias = diasNuevos;
          fechaFinPlan = moment(ahora).add(diasNuevos, 'days').toDate();
        }

        t.update(userDoc, {
          duracionDias: duracionTotalDias,
          planIlimitadoHasta: fechaFinPlan,
          creditos: 0,
          tipoPlan: "ilimitado",
          umbralConsultas: planSeguro.umbral,
          fechaActivacion: tienePlanIlimitadoActivo ? fechaActivacionActual : admin.firestore.FieldValue.serverTimestamp(),
          ultimaCompra: admin.firestore.FieldValue.serverTimestamp()
        });

        planOtorgado = { dias: duracionTotalDias, diasAgregados: diasNuevos, fechaFin: fechaFinPlan };

        t.update(pagoDoc, {
          descripcion,
          procesado: true,
          estado: "approved",
          procesadoEn: admin.firestore.FieldValue.serverTimestamp(),
          procesadoPor: processor,
          planOtorgado,
          tipoPlanNuevo: "ilimitado"
        });

        return {
          status: 'success',
          planOtorgado,
          descripcion,
          tipoPlanNuevo: "ilimitado"
        };
      }

      throw new Error(`Tipo de plan ${planSeguro.tipo} no reconocido`);
    });

    // Generación de PDF y envío de correo (fuera de la transacción)
    try {
      const invoiceData = {
        orderId: paymentRefString,
        date: new Date().toLocaleString('es-PE'),
        email: email || 'cliente@example.com',
        amount: montoNum,
        credits: result.creditosOtorgados || 0,
        description: result.descripcion || 'Compra Consulta PE',
        type: 'boleta'
      };

      const pdfPath = await generateInvoicePDF(invoiceData);
      const publicUrl = await uploadPDFToStorage(pdfPath, paymentRefString);

      await pagoDoc.update({
        pdfUrl: publicUrl,
        invoiceData: invoiceData
      });

      result.pdfUrl = publicUrl;

      // Limpiar archivo temporal
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

    } catch (pdfError) {
      logger.error(context, 'Error generando/subiendo PDF', pdfError);
    }

    processedPaymentsCache.set(paymentRefString, { uid, ...result });
    releasePaymentLock(paymentRefString);
    return result;

  } catch (error) {
    logger.error(context, 'Error procesando beneficio', error, { uid, paymentRef: paymentRefString });
    releasePaymentLock(paymentRefString);
    return { status: 'error', message: error.message };
  }
}

// ================================================================
// 🚀 WEBHOOK DE MERCADO PAGO (VALIDACIÓN OBLIGATORIA)
// ================================================================

export async function handleMercadoPagoWebhook(req, res) {
  const context = 'MP_WEBHOOK';
  const { type, data } = req.body;

  if (type !== 'payment') {
    return res.status(200).send('OK');
  }

  const paymentId = data.id;
  logger.info(context, 'Recibido webhook de pago', { paymentId });

  try {
    const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: paymentId });

    if (paymentData.status === 'approved') {
      const { external_reference, transaction_amount, metadata } = paymentData;
      
      // El external_reference suele contener el UID del usuario
      // El planId debe venir en metadata si lo configuramos en el checkout
      const uid = external_reference || metadata.user_id;
      const planId = metadata.plan_id;
      const email = paymentData.payer.email;

      if (!uid || !planId) {
        logger.error(context, 'Datos incompletos en el pago', { paymentId, uid, planId });
        return res.status(400).send('Incomplete payment data');
      }

      const result = await otorgarBeneficio(
        uid, 
        email, 
        transaction_amount, 
        'MercadoPago_Webhook', 
        paymentId.toString(), 
        false, 
        planId
      );

      logger.info(context, 'Beneficio procesado vía Webhook', { paymentId, result });
      return res.status(200).json(result);
    }

    return res.status(200).send('Payment not approved');

  } catch (error) {
    logger.error(context, 'Error en Webhook Mercado Pago', error);
    return res.status(500).send('Internal Server Error');
  }
}
