// index.js
import express from "express";
import admin from "firebase-admin";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// 🔥 CONFIGURACIÓN DE FIREBASE ADMIN SDK
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

// Inicializar Firebase
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("🟢 Firebase Admin SDK inicializado correctamente.");
  }
} catch (error) {
  console.error("🔴 Error al inicializar Firebase Admin SDK:", error.message);
}

const db = admin.firestore();

// -------------------------------------------------------------
// ⚙️ FUNCIÓN PARA ACTUALIZAR CRÉDITOS
async function actualizarCreditos(email, monto) {
  const usuariosRef = db.collection("usuarios");
  const snapshot = await usuariosRef.where("email", "==", email).get();

  if (snapshot.empty) {
    console.log(`⚠️ Usuario con email ${email} no encontrado.`);
    return;
  }

  let creditosExtra = 0;
  if (monto === 10) creditosExtra = 100;
  else if (monto === 20) creditosExtra = 250;
  else if (monto >= 50 && monto < 100) creditosExtra = 700;
  else if (monto >= 100) creditosExtra = 1500;

  snapshot.forEach(async (doc) => {
    const userRef = db.collection("usuarios").doc(doc.id);
    await userRef.update({
      creditos: admin.firestore.FieldValue.increment(creditosExtra),
      tipoPlan: "creditos",
      fechaActivacion: new Date(),
      duracionDias: 0,
    });
    console.log(`✅ Créditos actualizados para ${email}: +${creditosExtra}`);
  });
}

// -------------------------------------------------------------
// 💳 WEBHOOK MERCADO PAGO (pagos pequeños: 10 y 20 soles)
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { email, monto, estado } = req.body;

    if (estado !== "approved" && estado !== "pagado") {
      return res.status(400).json({ message: "Pago no confirmado" });
    }

    await actualizarCreditos(email, monto);
    res.json({ message: "✅ Créditos activados correctamente (Mercado Pago)" });
  } catch (error) {
    console.error("❌ Error en webhook Mercado Pago:", error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 💰 WEBHOOK FLOW (pagos de 50 soles o más)
app.post("/webhook/flow", async (req, res) => {
  try {
    const { email, monto, estado } = req.body;

    if (estado !== "pagado" && estado !== "paid") {
      return res.status(400).json({ message: "Pago no confirmado" });
    }

    await actualizarCreditos(email, monto);
    res.json({ message: "✅ Créditos activados correctamente (Flow)" });
  } catch (error) {
    console.error("❌ Error en webhook Flow:", error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 🧠 TEST GENERAL
app.get("/", (req, res) => {
  res.send("🚀 API de pagos funcionando correctamente.");
});

// -------------------------------------------------------------
// 🔊 PUERTO (Fly.io usa por defecto 8080)
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`)
);
