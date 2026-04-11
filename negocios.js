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

      const firestoreCheck = await db.collection('_healthcheck').doc('connection').get()
        .then(() => ({ status: 'connected', message: 'Conexión a Firestore exitosa' }))
        .catch(error => ({ status: 'error', message: error.message }));

      logger.info('FIRESTORE', 'Verificación de conexión', firestoreCheck);

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
// 💳 CONFIGURACIÓN DE MERCADO PAGO
// ================================================================

export const PAQUETES_CREDITOS = { 10: 60, 20: 125, 30: 200, 50: 330, 100: 700, 200: 1500 };
export const PLANES_ILIMITADOS = { 60: 7, 80: 15, 110: 30, 160: 60, 510: 70 };

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
 */
export async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRefString, resend) {
  const context = 'OTORGAR_BENEFICIO';
  
  if (!db) {
    logger.error(context, 'Base de datos no disponible');
    return { status: 'error', message: 'Database not available' };
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

    const montoNum = Number(montoPagado);
    const result = await db.runTransaction(async (t) => {
      const userDoc = db.collection("usuarios").doc(uid);
      const userSnap = await t.get(userDoc);

      if (!userSnap.exists) {
        throw new Error(`Usuario ${uid} no encontrado`);
      }

      const userData = userSnap.data();
      const creditosActuales = userData.creditos || 0;
      const tipoPlanActual = userData.tipoPlan || "creditos";
      const fechaActivacionActual = userData.fechaActivacion;
      const planIlimitadoHastaActual = userData.planIlimitadoHasta;
      const duracionDiasActual = userData.duracionDias || 0;

      let creditosOtorgados = 0;
      let descripcion = "";
      let planOtorgado = null;

      if (PAQUETES_CREDITOS[montoNum]) {
        creditosOtorgados = PAQUETES_CREDITOS[montoNum];
        const nuevosCreditos = creditosActuales + creditosOtorgados;

        t.update(userDoc, {
          creditos: nuevosCreditos,
          tipoPlan: "creditos",
          ultimaCompra: admin.firestore.FieldValue.serverTimestamp()
        });

        descripcion = `Paquete de ${creditosOtorgados} créditos`;
        logger.info(context, '💰 Créditos otorgados exitosamente', { uid, creditosOtorgados, nuevosCreditos });

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
        } else {
          fechaActivacion = ahora;
          duracionTotalDias = diasNuevos;
          fechaFinPlan = moment(ahora).add(diasNuevos, 'days').toDate();
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

      } else {
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
      result.pdfUrl = storageUrl;

    } catch (pdfError) {
      logger.error(context, '⚠️ Error generando/subiendo PDF', pdfError);
    }

    processedPaymentsCache.set(paymentRefString, {
      uid,
      timestamp: new Date().toISOString(),
      processor,
      status: 'processed',
      pdfUrl: result.pdfUrl || null
    });

    setTimeout(() => processedPaymentsCache.delete(paymentRefString), 2 * 60 * 60 * 1000);

    let userName = email.split('@')[0];
    try {
      const userSnap = await db.collection('usuarios').doc(uid).get();
      if (userSnap.exists) {
        const userData = userSnap.data();
        userName = userData.name || userData.displayName || userName;
      }
    } catch (err) {}

    enviarCorreoCompra(email, userName, paymentRefString, montoPagado, result.descripcion, result.pdfUrl, resend)
      .catch(err => logger.error(context, 'Error en envío de correo', err));

    releasePaymentLock(paymentRefString);
    return result;

  } catch (error) {
    logger.error(context, '❌ Error en otorgarBeneficio', error);
    try {
      await pagoDoc.update({
        procesado: false,
        estado: "error",
        error: error.message,
        fallidoEn: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {}
    releasePaymentLock(paymentRefString);
    return { status: 'error', message: error.message };
  }
}

// ================================================================
// ✉️ FUNCIONES DE CORREO
// ================================================================

export async function enviarBienvenida(email, nombre, resend) {
  const context = 'ENVIAR_BIENVENIDA';
  try {
    const templatePath = path.join(__dirname, 'emails', 'bienvenida-usuario-nuevo.html');
    if (!fs.existsSync(templatePath)) throw new Error('Plantilla no encontrada');
    
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');
    htmlContent = htmlContent.replace(/{{nombre}}/g, nombre);
    
    const result = await resend.emails.send({
      from: 'Masitaprex <no-reply@masitaprex.com>',
      to: email,
      subject: 'Bienvenido a Masitaprex',
      html: htmlContent
    });
    return { success: true, id: result.id };
  } catch (error) {
    logger.error(context, '❌ Error enviando bienvenida', error);
    return { success: false, error: error.message };
  }
}

export async function enviarCorreoCompra(email, nombre, orderId, monto, descripcion, urlBoleta, resend) {
  const context = 'ENVIAR_CORREO_COMPRA';
  try {
    const templatePath = path.join(__dirname, 'emails', 'compra-exitosa.html');
    if (!fs.existsSync(templatePath)) return { success: false, error: 'Plantilla no encontrada' };
    
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');
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
    return { success: true, id: result.id };
  } catch (error) {
    logger.error(context, '❌ Error enviando correo de compra', error);
    return { success: false, error: error.message };
  }
}

export async function enviarCorreoSospechoso(email, nombre, location, ip, userAgent, resend) {
  const context = 'ENVIAR_CORREO_SOSPECHOSO';
  try {
    const templatePath = path.join(__dirname, 'emails', 'intento-inicio-seccion-sospechoso.html');
    if (!fs.existsSync(templatePath)) {
      logger.error(context, 'Plantilla no encontrada en: ' + templatePath);
      return { success: false, error: 'Plantilla no encontrada' };
    }
    
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');
    const ubicacionStr = `${location.city || 'Desconocida'}, ${location.region || ''}, ${location.country || ''}`;
    
    htmlContent = htmlContent.replace(/{{nombre}}/g, nombre || 'Usuario');
    htmlContent = htmlContent.replace(/{{ubicacion}}/g, ubicacionStr);
    htmlContent = htmlContent.replace(/{{ip}}/g, ip);
    htmlContent = htmlContent.replace(/{{isp}}/g, location.isp || 'Desconocido');
    htmlContent = htmlContent.replace(/{{tipo_conexion}}/g, location.type || 'Desconocido');
    htmlContent = htmlContent.replace(/{{fecha_hora}}/g, new Date().toLocaleString('es-PE'));
    htmlContent = htmlContent.replace(/{{dispositivo}}/g, userAgent || 'Desconocido');
    
    const result = await resend.emails.send({
      from: 'Seguridad Masitaprex <seguridad@masitaprex.com>',
      to: email,
      subject: '⚠️ Intento de inicio de sesión sospechoso - Masitaprex',
      html: htmlContent
    });
    return { success: true, id: result.id };
  } catch (error) {
    logger.error(context, '❌ Error enviando correo sospechoso', error);
    return { success: false, error: error.message };
  }
}

export async function enviarCorreoRechazo(email, nombre, orderId, monto, descripcion, motivo, resend) {
  const context = 'ENVIAR_CORREO_RECHAZO';
  try {
    const templatePath = path.join(__dirname, 'emails', 'compra-rechazada.html');
    if (!fs.existsSync(templatePath)) return { success: false, error: 'Plantilla no encontrada' };
    
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');
    htmlContent = htmlContent.replace(/{{nombre}}/g, nombre || 'Cliente');
    htmlContent = htmlContent.replace(/{{orderId}}/g, orderId);
    htmlContent = htmlContent.replace(/{{monto}}/g, monto);
    htmlContent = htmlContent.replace(/{{descripcion}}/g, descripcion);
    
    // Mapeo de motivos comunes de Mercado Pago
    const motivosMap = {
      'cc_rejected_insufficient_amount': 'Fondos insuficientes en la tarjeta.',
      'cc_rejected_bad_filled_security_code': 'Código de seguridad (CVV) incorrecto.',
      'cc_rejected_bad_filled_date': 'Fecha de expiración incorrecta.',
      'cc_rejected_bad_filled_other': 'Datos de la tarjeta incorrectos.',
      'cc_rejected_call_for_authorize': 'La entidad emisora requiere autorización telefónica.',
      'cc_rejected_card_disabled': 'La tarjeta no está activa para compras por internet.',
      'cc_rejected_card_error': 'Error al procesar la tarjeta.',
      'cc_rejected_duplicated_payment': 'Pago duplicado detectado.',
      'cc_rejected_high_risk': 'El pago fue rechazado por políticas de seguridad.',
      'cc_rejected_invalid_installments': 'Número de cuotas no permitido para esta tarjeta.',
      'cc_rejected_max_attempts': 'Se ha superado el número máximo de intentos.',
      'cc_rejected_other_reason': 'Error general en la transacción bancaria.'
    };

    const mensajeMotivo = motivosMap[motivo] || motivo || 'No se pudo procesar el pago con la entidad bancaria.';
    htmlContent = htmlContent.replace(/fondos insuficientes o restricción bancaria/g, mensajeMotivo);
    
    const result = await resend.emails.send({
      from: 'Facturación Masitaprex <facturacion@masitaprex.com>',
      to: email,
      subject: `Pago Rechazado #${orderId} - Masitaprex`,
      html: htmlContent
    });
    return { success: true, id: result.id };
  } catch (error) {
    logger.error(context, '❌ Error enviando correo de rechazo', error);
    return { success: false, error: error.message };
  }
}

// ================================================================
// 🍪 HELPERS DE SESIÓN
// ================================================================

export async function createSessionCookie(idToken) {
  const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 días
  const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
  return { sessionCookie, expiresIn };
}
