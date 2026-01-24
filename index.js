import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone"; 
import { MercadoPagoConfig, Payment } from "mercadopago"; 
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

const mpClient = new MercadoPagoConfig({ 
  accessToken: MERCADOPAGO_ACCESS_TOKEN ? MERCADOPAGO_ACCESS_TOKEN.trim() : '',
  options: { timeout: 7000 } 
});

const PAQUETES_CREDITOS = { 10: 60, 20: 125, 30: 200, 50: 330, 100: 700, 200: 1500 };
const PLANES_ILIMITADOS = { 60: 7, 80: 15, 110: 30, 160: 60, 510: 70 };

async function otorgarBeneficio(uid, email, montoPagado, processor, paymentRef) {
  if (!db) return;
  const pagoDoc = db.collection("pagos_registrados").doc(paymentRef);
  const doc = await pagoDoc.get();
  if (doc.exists) return;

  await pagoDoc.set({
    uid, email, monto: montoPagado, processor,
    fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
    estado: "approved"
  });

  const userDoc = db.collection("usuarios").doc(uid);
  return await db.runTransaction(async (t) => {
    const user = await t.get(userDoc);
    if (!user.exists) return;
    let descripcion = PAQUETES_CREDITOS[montoPagado] ? `${PAQUETES_CREDITOS[montoPagado]} Créditos` : "Plan Ilimitado";
    if (PAQUETES_CREDITOS[montoPagado]) {
      t.update(userDoc, { creditos: (user.data().creditos || 0) + PAQUETES_CREDITOS[montoPagado] });
    } else if (PLANES_ILIMITADOS[montoPagado]) {
      const fin = moment().add(PLANES_ILIMITADOS[montoPagado], 'days').toDate();
      t.update(userDoc, { planIlimitadoHasta: fin });
    }
    t.update(pagoDoc, { descripcion });
  });
}

// =======================================================
// 🚀 Endpoints API
// =======================================================

app.post("/api/pay", async (req, res) => {
  try {
    const { token, amount, email, uid, description, installments, payment_method_id, issuer_id } = req.body;
    
    console.log("--- INTENTO DE PAGO ---");
    console.log("Email pagador:", email);
    
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
          identification: {
            type: "DNI",
            number: "45678912" // DNI ficticio necesario en Perú
          }
        },
        metadata: { uid, email, amount }
      }
    };

    const result = await payment.create(paymentData);
    
    console.log("--- RESULTADO MP ---");
    console.log("ID:", result.id);
    console.log("Estado:", result.status);
    console.log("Detalle específico:", result.status_detail);

    if (result.status === 'approved') {
      await otorgarBeneficio(uid, email, Number(amount), 'MP Card', result.id.toString());
    }

    res.json(result);

  } catch (error) {
    console.error("🔴 ERROR CRÍTICO:");
    if (error.api_response) {
      console.error(JSON.stringify(error.api_response.body, null, 2));
      res.status(400).json(error.api_response.body);
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Ruta comodín para cargar la Web
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor en puerto ${PORT}`));
