import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone"; 
import axios from "axios"; 
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

// =======================================================
// 🔧 Configuración de Firebase
// =======================================================
function buildServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      return sa;
    } catch (e) { return null; }
  }
  if (process.env.FIREBASE_PROJECT_ID) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    };
  }
  return null;
}

const serviceAccount = buildServiceAccountFromEnv();
let db;
if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
  console.log("🟢 Firebase Admin SDK inicializado.");
}

// =======================================================
// 💳 Configuración de Mercado Pago
// =======================================================
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const HOST_URL = process.env.HOST_URL || `https://${process.env.FLY_APP_NAME}.fly.dev`;

let mpClient;
if (MERCADOPAGO_ACCESS_TOKEN) {
  // Aseguramos que el token no tenga espacios extra
  mpClient = new MercadoPagoConfig({ 
    accessToken: MERCADOPAGO_ACCESS_TOKEN.trim(),
    options: { timeout: 5000 } 
  });
  console.log("🟢 Mercado Pago SDK configurado.");
}

const PAQUETES_CREDITOS = { 10: 60, 20: 125, 30: 200, 50: 330, 100: 700, 200: 1500 };
const PLANES_ILIMITADOS = { 60: 7, 80: 15, 110: 30, 160: 60, 510: 70 };

async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRef) {
  if (!db) return;
  const pagoDoc = db.collection("pagos_registrados").doc(paymentRef);
  const doc = await pagoDoc.get();
  if (doc.exists) return { status: 'already_processed' };

  await pagoDoc.set({
    uid, email, monto: montoPagado, processor,
    fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
    estado: "approved"
  });

  const userDoc = db.collection("usuarios").doc(uid);
  return await db.runTransaction(async (t) => {
    const user = await t.get(userDoc);
    if (!user.exists) return;
    
    let descripcion = "";
    if (PAQUETES_CREDITOS[montoPagado]) {
      const otorgados = PAQUETES_CREDITOS[montoPagado];
      t.update(userDoc, { creditos: (user.data().creditos || 0) + otorgados });
      descripcion = `${otorgados} Créditos`;
    } else if (PLANES_ILIMITADOS[montoPagado]) {
      const fin = moment().add(PLANES_ILIMITADOS[montoPagado], 'days').toDate();
      t.update(userDoc, { planIlimitadoHasta: fin });
      descripcion = `Plan Ilimitado`;
    }
    t.update(pagoDoc, { descripcion });
    return { status: 'success' };
  });
}

// =======================================================
// 🚀 Endpoints API
// =======================================================

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
    const { token, amount, email, uid, description, installments, payment_method_id, issuer_id } = req.body;
    
    console.log("--- INTENTO DE PAGO ---");
    console.log("Payer:", email);
    console.log("Monto:", amount);

    const payment = new Payment(mpClient);
    
    const paymentData = {
      body: {
        transaction_amount: Number(amount),
        token,
        description,
        installments: Number(installments),
        payment_method_id,
        issuer_id: issuer_id ? Number(issuer_id) : undefined, // Importante: convertir a número si existe
        payer: { email },
        notification_url: `${HOST_URL}/api/webhook/mercadopago`,
        metadata: { uid, email, amount }
      }
    };

    const result = await payment.create(paymentData);
    
    console.log("--- RESULTADO MP ---");
    console.log("ID:", result.id);
    console.log("Estado:", result.status);

    if (result.status === 'approved') {
      await otorgarBeneficio(uid, email, Number(amount), 'MP Card', result.id.toString());
    }

    res.json(result);
  } catch (error) {
    console.error("🔴 ERROR DETALLADO DE MERCADO PAGO:");
    
    // El SDK v2 devuelve el error en api_response
    if (error.api_response) {
      console.error("Status Code:", error.api_response.status);
      console.error("Cuerpo del Error:", JSON.stringify(error.api_response.body, null, 2));
    } else {
      console.error("Mensaje:", error.message);
    }
    
    res.status(500).json({ 
      error: "Error al procesar el pago", 
      details: error.api_response?.body || error.message 
    });
  }
});

app.post("/api/webhook/mercadopago", async (req, res) => {
  const { action, data } = req.body;
  if (action === "payment.created" || action === "payment.updated") {
    try {
      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: data.id });
      if (paymentInfo.status === "approved") {
        const { uid, email, amount } = paymentInfo.metadata;
        await otorgarBeneficio(uid, email, Number(amount), 'MP Webhook', data.id.toString());
      }
    } catch (error) { console.error("Error Webhook:", error.message); }
  }
  res.sendStatus(200);
});

app.post("/api/generate-invoice", async (req, res) => {
  try {
    const { paymentId, type, ruc, razonSocial } = req.body;
    const doc = await db.collection("pagos_registrados").doc(paymentId.toString()).get();
    const pdfUrl = await generateInvoicePDF({
      orderId: paymentId,
      date: moment().tz("America/Lima").format('YYYY-MM-DD HH:mm:ss'),
      email: doc.data().email,
      amount: doc.data().monto,
      description: doc.data().descripcion,
      type, ruc, razonSocial
    });
    res.json({ pdfUrl });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor listo en puerto ${PORT}`));
