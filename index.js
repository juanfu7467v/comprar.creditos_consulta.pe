import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone"; 
import axios from "axios"; 
import { MercadoPagoConfig, Payment } from "mercadopago"; 
import { generateInvoicePDF } from './pdfGenerator.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// =======================================================
// 🔧 Configuración de Firebase desde variables de entorno
// =======================================================
function buildServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
      const sa = JSON.parse(saRaw);
      if (sa.private_key && sa.private_key.includes("\\n")) {
        sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      }
      return sa;
    } catch (e) {
      console.error("❌ Error parseando FIREBASE_SERVICE_ACCOUNT:", e.message);
      return null;
    }
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
    return {
      type: process.env.FIREBASE_TYPE || "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : undefined,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    };
  }

  console.error("❌ No se encontró configuración de Firebase.");
  return null;
}

const serviceAccount = buildServiceAccountFromEnv();
let db;
try {
  if (!serviceAccount) throw new Error("Credenciales Firebase inválidas.");
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("🟢 Firebase Admin SDK inicializado correctamente.");
  }
  db = admin.firestore();
} catch (error) {
  console.error("🔴 Error al inicializar Firebase:", error.message);
  db = null;
}

// =======================================================
// 💳 Configuración de Pago
// =======================================================
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const HOST_URL = process.env.HOST_URL || "http://localhost:8080";

let mpClient;
if (MERCADOPAGO_ACCESS_TOKEN) {
  mpClient = new MercadoPagoConfig({ 
    accessToken: MERCADOPAGO_ACCESS_TOKEN,
  });
  console.log("🟢 Mercado Pago SDK configurado.");
} else {
  console.warn("⚠️ MERCADOPAGO_ACCESS_TOKEN no encontrado.");
}

const PAQUETES_CREDITOS = {
  10: 60,
  20: 125, 
  50: 330, 
  100: 700, 
  200: 1500, 
};

const PLANES_ILIMITADOS = {
  60: 7,
  80: 15, 
  110: 30, 
  160: 60, 
  510: 70,
};

// =======================================================
// 💎 Función para otorgar beneficios y generar PDF
// =======================================================
async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRef) {
  console.log(`Iniciando otorgarBeneficio para ${email} (UID: ${uid}), Monto: ${montoPagado}, Ref: ${paymentRef}`);
  if (!db) throw new Error("Firestore no inicializado.");
  
  const pagosRef = db.collection("pagos_registrados");
  const pagoDoc = pagosRef.doc(paymentRef);

  try {
    const docSnapshot = await pagoDoc.get();
    if (docSnapshot.exists) {
      console.warn(`⚠️ IDEMPOTENCIA: Compra ${paymentRef} ya fue procesada.`);
      return { status: 'already_processed', data: docSnapshot.data() };
    }

    await pagoDoc.set({
      uid, email, monto: montoPagado, processor,
      fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
      estado: "approved"
    });
  } catch (error) {
    throw new Error(`Error al verificar idempotencia: ${error.message}`);
  }

  const usuariosRef = db.collection("usuarios");
  const userDoc = usuariosRef.doc(uid);

  return await db.runTransaction(async (t) => {
    const doc = await t.get(userDoc);
    if (!doc.exists) throw new Error("Usuario no existe.");

    const userData = doc.data();
    let nuevosCreditos = userData.creditos || 0;
    let descripcion = "";
    let creditosOtorgados = 0;

    if (PAQUETES_CREDITOS[montoPagado]) {
      creditosOtorgados = PAQUETES_CREDITOS[montoPagado];
      nuevosCreditos += creditosOtorgados;
      descripcion = `${creditosOtorgados} Créditos`;
    } else if (PLANES_ILIMITADOS[montoPagado]) {
      const dias = PLANES_ILIMITADOS[montoPagado];
      const finPlan = moment().add(dias, 'days').toDate();
      t.update(userDoc, { planIlimitadoHasta: finPlan });
      descripcion = `Plan Ilimitado ${dias} días`;
    }

    t.update(userDoc, { 
      creditos: nuevosCreditos,
      numComprasExitosa: (userData.numComprasExitosa || 0) + 1
    });

    // Generar PDF
    const pdfUrl = await generateInvoicePDF({
      orderId: paymentRef,
      date: moment().tz("America/Lima").format('YYYY-MM-DD HH:mm:ss'),
      email,
      amount: montoPagado,
      credits: creditosOtorgados,
      description
    });

    t.update(pagoDoc, { pdfUrl });

    return { status: 'success', pdfUrl, descripcion };
  });
}

// =======================================================
// 🚀 Endpoints
// =======================================================

// 1. Crear Pago (Checkout API - Core Methods)
app.post("/api/pay", async (req, res) => {
  try {
    const { token, amount, email, uid, description, installments, payment_method_id, issuer_id } = req.body;

    if (!mpClient) return res.status(500).json({ error: "Mercado Pago no configurado" });

    const payment = new Payment(mpClient);
    const paymentData = {
      body: {
        transaction_amount: Number(amount),
        token,
        description,
        installments: Number(installments),
        payment_method_id,
        issuer_id,
        payer: { email },
        notification_url: `${HOST_URL}/api/webhook/mercadopago`,
        metadata: { uid, email, amount }
      }
    };

    const result = await payment.create(paymentData);
    res.json(result);
  } catch (error) {
    console.error("Error al crear pago:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Webhook para confirmación real
app.post("/api/webhook/mercadopago", async (req, res) => {
  const { action, data } = req.body;
  
  if (action === "payment.created" || action === "payment.updated") {
    try {
      const paymentId = data.id;
      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });
      
      if (paymentInfo.status === "approved") {
        const { uid, email, amount } = paymentInfo.metadata;
        await otorgarBeneficio(uid, email, Number(amount), 'Mercado Pago Card', paymentId.toString());
      }
    } catch (error) {
      console.error("Error en Webhook:", error.message);
    }
  }
  res.sendStatus(200);
});

// 3. Consultar estado de pago y obtener PDF
app.get("/api/payment-status/:id", async (req, res) => {
  try {
    const paymentId = req.params.id;
    const pagoDoc = await db.collection("pagos_registrados").doc(paymentId).get();
    
    if (pagoDoc.exists) {
      res.json(pagoDoc.data());
    } else {
      res.status(404).json({ error: "Pago no encontrado" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Servidor de Pagos Consulta PE" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor en puerto ${PORT}`));
