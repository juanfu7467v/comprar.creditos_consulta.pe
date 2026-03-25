import { db, admin } from "../config/firebase.js";
import logger from "../utils/logger.js";
import fs from "fs";
import { generateInvoicePDF } from "./pdfService.js";

const PAQUETES_CREDITOS = {
  5: 10,
  10: 25,
  20: 60,
  50: 160,
  100: 350
};

const PLANES_ILIMITADOS = {
  30: 30,
  80: 90,
  150: 180,
  250: 365
};

const processedPaymentsCache = new Map();
const paymentLocks = new Set();

async function acquirePaymentLock(paymentRef) {
  if (paymentLocks.has(paymentRef)) return false;
  paymentLocks.add(paymentRef);
  return true;
}

function releasePaymentLock(paymentRef) {
  paymentLocks.delete(paymentRef);
}

export async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRef, bucket) {
  const context = 'OTORGAR_BENEFICIO';
  const paymentRefString = String(paymentRef);

  if (processedPaymentsCache.has(paymentRefString)) {
    return { status: 'already_processed' };
  }

  const lockAcquired = await acquirePaymentLock(paymentRefString);
  if (!lockAcquired) return { status: 'error', message: 'Lock error' };

  try {
    const pagoDoc = db.collection("pagos_registrados").doc(paymentRefString);
    const doc = await pagoDoc.get();

    if (doc.exists && doc.data().procesado) {
      releasePaymentLock(paymentRefString);
      return { status: 'already_processed' };
    }

    const userDoc = db.collection("usuarios").doc(uid);
    const result = await db.runTransaction(async (t) => {
      const user = await t.get(userDoc);
      if (!user.exists) throw new Error(`User ${uid} not found`);

      const userData = user.data();
      const montoNum = Number(montoPagado);
      let creditosOtorgados = 0;
      let descripcion = "";

      if (PAQUETES_CREDITOS[montoNum]) {
        creditosOtorgados = PAQUETES_CREDITOS[montoNum];
        t.update(userDoc, {
          creditos: (userData.creditos || 0) + creditosOtorgados,
          tipoPlan: "creditos",
          ultimaCompra: admin.firestore.FieldValue.serverTimestamp()
        });
        descripcion = `${creditosOtorgados} Créditos`;
      } else if (PLANES_ILIMITADOS[montoNum]) {
        const dias = PLANES_ILIMITADOS[montoNum];
        t.update(userDoc, {
          tipoPlan: "ilimitado",
          duracionDias: dias,
          ultimaCompra: admin.firestore.FieldValue.serverTimestamp()
        });
        descripcion = `Plan Ilimitado ${dias} días`;
      }

      t.set(pagoDoc, {
        procesado: true,
        procesadoEn: admin.firestore.FieldValue.serverTimestamp(),
        estado: "approved"
      }, { merge: true });

      return { creditosOtorgados, descripcion };
    });

    // Generar PDF y subirlo (simplificado para brevedad, asumiendo lógica previa)
    const pdfPath = await generateInvoicePDF({
        orderId: paymentRefString,
        email,
        amount: montoPagado,
        description: result.descripcion
    });

    // Lógica de subida a storage iría aquí...
    
    processedPaymentsCache.set(paymentRefString, { uid, timestamp: new Date().toISOString() });
    releasePaymentLock(paymentRefString);
    return { status: 'success', ...result };

  } catch (error) {
    releasePaymentLock(paymentRefString);
    logger.error(context, 'Error otorgando beneficio', error);
    throw error;
  }
}
