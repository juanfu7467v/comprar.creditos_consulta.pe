import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone"; 
import { MercadoPagoConfig, Payment } from "mercadopago"; 
import { generateInvoicePDF } from './pdfGenerator.js';
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// --- Configuración de Firebase ---
function buildServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      return sa;
    } catch (e) { return null; }
  }
  return null;
}

const serviceAccount = buildServiceAccountFromEnv();
let db;
if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
  console.log("🟢 Firebase Admin inicializado.");
}

// --- Configuración de Mercado Pago ---
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
// IMPORTANTE: Asegúrate de que HOST_URL en Fly.io sea https://tu-app.fly.dev (SIN EL / AL FINAL)
const HOST_URL = process.env.HOST_URL || `https://${process.env.FLY_APP_NAME}.fly.dev`;

const mpClient = new MercadoPagoConfig({ 
  accessToken: (MERCADOPAGO_ACCESS_TOKEN || "").trim(),
  options: { timeout: 7000 } 
});

const PAQUETES_CREDITOS = { 10: 60, 20: 125, 30: 200, 50: 330, 100: 700, 200: 1500 };
const PLANES_ILIMITADOS = { 60: 7, 80: 15, 110: 30, 160: 60, 510: 70 };

async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRef) {
  if (!db || !uid) return { status: 'error', message: 'No UID' };
  
  const pagoDoc = db.collection("pagos_registrados").doc(paymentRef);
  const doc = await pagoDoc.get();
  
  // Evitar duplicados (Idempotencia)
  if (doc.exists) return { status: 'already_processed' };

  console.log(`🚀 Otorgando beneficio a UID: ${uid} por S/ ${montoPagado}`);

  await pagoDoc.set({
    uid, email, monto: montoPagado, processor,
    fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
    estado: "approved"
  });

  const userDoc = db.collection("usuarios").doc(uid);
  return await db.runTransaction(async (t) => {
    const user = await t.get(userDoc);
    if (!user.exists) return { status: 'error', message: 'User not found' };
    
    let descripcion = "";
    const montoNum = Number(montoPagado);

    if (PAQUETES_CREDITOS[montoNum]) {
      const otorgados = PAQUETES_CREDITOS[montoNum];
      t.update(userDoc, { creditos: (user.data().creditos || 0) + otorgados });
      descripcion = `${otorgados} Créditos`;
    } else if (PLANES_ILIMITADOS[montoNum]) {
      const fin = moment().add(PLANES_ILIMITADOS[montoNum], 'days').toDate();
      t.update(userDoc, { planIlimitadoHasta: fin });
      descripcion = `Plan Ilimitado`;
    }
    
    t.update(pagoDoc, { descripcion });
    return { status: 'success' };
  });
}

// --- API Endpoints ---

app.get("/api/config", (req, res) => {
  res.json({
    mercadopagoPublicKey: process.env.MERCADOPAGO_PUBLIC_KEY,
    firebaseConfig: {
      apiKey: process.env.FIREBASE_API_KEY,
      projectId: process.env.FIREBASE_PROJECT_ID,
    }
  });
});

app.post("/api/pay", async (req, res) => {
  try {
    const { 
      token, amount, email, uid, description, installments, 
      payment_method_id, issuer_id, identificationType, identificationNumber 
    } = req.body;

    const payment = new Payment(mpClient);
    
    const paymentData = {
      body: {
        transaction_amount: Number(amount),
        token,
        description,
        installments: Number(installments),
        payment_method_id,
        issuer_id: issuer_id ? Number(issuer_id) : undefined,
        payer: { 
          email: email,
          identification: { type: identificationType, number: identificationNumber }
        },
        // Notificación para pagos aprobados después (Yape, Efectivo, etc)
        notification_url: `${HOST_URL}/api/webhook/mercadopago`,
        // Metadatos en minúsculas para evitar problemas de case-sensitivity
        metadata: { uid: uid, email: email, amount: amount }
      }
    };

    const result = await payment.create(paymentData);
    
    // Si se aprueba al instante (tarjetas), activamos créditos ya mismo
    if (result.status === 'approved') {
      await otorgarBeneficio(uid, email, Number(amount), 'MP Card Instant', result.id.toString());
    }

    res.json(result);
  } catch (error) {
    console.error("🔴 Error Pago:", error.api_response?.body || error.message);
    res.status(400).json(error.api_response?.body || { error: error.message });
  }
});

app.post("/api/webhook/mercadopago", async (req, res) => {
  const { action, data, type } = req.body;
  
  // Escuchar tanto formato nuevo como antiguo
  if (action === "payment.created" || action === "payment.updated" || type === "payment") {
    try {
      const paymentId = data?.id || req.body.data?.id;
      if (!paymentId) return res.sendStatus(200);

      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      if (paymentInfo.status === "approved") {
        // Leemos metadatos con fallback
        const metadata = paymentInfo.metadata;
        const uid = metadata?.uid;
        const email = metadata?.email;
        const amount = metadata?.amount;

        if (uid) {
          await otorgarBeneficio(uid, email, Number(amount), 'MP Webhook', paymentId.toString());
          console.log(`✅ Webhook: Créditos activados para ${uid}`);
        }
      }
    } catch (error) {
      console.error("🔴 Error Webhook:", error.message);
    }
  }
  res.sendStatus(200);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
