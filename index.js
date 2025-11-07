import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone"; // Para manejo profesional de fechas/horas y zona horaria

// Dependencias de Pago
import mercadopago from "mercadopago";
// import flow from "flow-node-sdk"; // ⚠️ Descomentar e instalar el SDK de Flow real si lo tienes
// ⚠️ Si Flow es un simple cliente HTTP, el "flowClient" debe ser configurado como tal.

const app = express();
app.use(cors());
app.use(express.json());

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

// Inicializar Firebase
const serviceAccount = buildServiceAccountFromEnv();
try {
  if (!serviceAccount) throw new Error("Credenciales Firebase inválidas.");
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("🟢 Firebase Admin SDK inicializado correctamente.");
  }
} catch (error) {
  console.error("🔴 Error al inicializar Firebase:", error.message);
}

let db;
try {
  db = admin.firestore();
} catch (e) {
  console.warn("⚠️ Firestore no disponible:", e.message);
  db = null;
}

// =======================================================
// 💳 Configuración de Flow y Mercado Pago
// =======================================================
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY;
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const HOST_URL = process.env.HOST_URL || "http://localhost:8080";

// Inicialización de Mercado Pago SDK
if (MERCADOPAGO_ACCESS_TOKEN) {
  mercadopago.configure({ access_token: MERCADOPAGO_ACCESS_TOKEN });
  console.log("🟢 Mercado Pago SDK configurado.");
} else {
  console.warn("⚠️ MERCADOPAGO_ACCESS_TOKEN no encontrado.");
}

// Inicialización de Flow SDK (Mock o Real)
let flowClient = null;
if (FLOW_API_KEY && FLOW_SECRET_KEY) {
  // ⚠️ Aquí debes usar la inicialización real de tu SDK de Flow.
  // Ejemplo real (si existe el SDK): flowClient = new flow.FlowClient(FLOW_API_KEY, FLOW_SECRET_KEY);
  // Simulación:
  flowClient = {
    createPayment: ({ commerceOrder, subject, amount, email }) => {
      console.log(`[Flow Mock] Creando pago por ${amount} PEN...`);
      // Simula la respuesta de Flow, usando los callbacks configurados
      const urlReturn = `${HOST_URL}/api/flow?monto=${amount}&uid=${commerceOrder.split('-')[1]}&email=${email}&estado=pagado&ref=${commerceOrder}`;
      
      return Promise.resolve({
        url: `https://mock.flow.cl/payment/redirect?token=${commerceOrder}&returnUrl=${encodeURIComponent(urlReturn)}`,
        token: commerceOrder
      });
    }
  };
  console.log("🟢 Flow Client configurado (simulado o real).");
} else {
  console.warn("⚠️ Flow API Keys no encontrados. La funcionalidad de Flow estará simulada o fallará.");
}

// =======================================================
// 🎯 Configuración de paquetes de créditos y planes
// =======================================================
const PAQUETES_CREDITOS = {
  10: 60, // S/ 10 -> 60 créditos
  20: 125, // S/ 20 -> 125 créditos
  50: 330, // S/ 50 -> 330 créditos
  100: 700, // S/ 100 -> 700 créditos
  200: 1500, // S/ 200 -> 1500 créditos
};
const CREDITOS_CORTESIA = 3;

const PLANES_ILIMITADOS = {
  60: 7, // S/ 60 -> 7 Días
  80: 15, // S/ 80 -> 15 Días
  110: 30, // S/ 110 -> 30 Días
  160: 60, // S/ 160 -> 60 Días
  510: 70, // S/ 510 -> 70 Días
};

// =======================================================
// 💎 Función para otorgar créditos o plan ilimitado y generar mensaje
// =======================================================
/**
 * Otorga el beneficio (créditos o plan) al usuario después de la confirmación de pago.
 * @param {string} uid - ID de usuario de Firebase.
 * @param {string} email - Email del usuario.
 * @param {number} montoPagado - Monto pagado en soles (PEN).
 * @returns {Promise<object>} - Objeto con el tipo de plan y el mensaje de confirmación.
 */
async function otorgarBeneficio(uid, email, montoPagado) {
  if (!db) throw new Error("Firestore no inicializado.");

  const usuariosRef = db.collection("usuarios");
  let userDoc;

  // 1. Encontrar o crear el documento de usuario
  if (uid) {
    userDoc = usuariosRef.doc(uid);
  } else if (email) {
    const snapshot = await usuariosRef.where("email", "==", email).limit(1).get();
    if (snapshot.empty) throw new Error("Usuario no encontrado por email.");
    userDoc = usuariosRef.doc(snapshot.docs[0].id);
  } else {
    throw new Error("Falta UID o Email para identificar usuario.");
  }

  const doc = await userDoc.get();
  if (!doc.exists) throw new Error("Documento de usuario no existe en Firestore.");

  // 2. Determinar el beneficio
  let tipoPlan = "";
  let creditosComprados = 0;
  let creditosOtorgadosTotal = 0;
  let duracionDias = 0;

  if (PAQUETES_CREDITOS[montoPagado]) {
    tipoPlan = "creditos";
    creditosComprados = PAQUETES_CREDITOS[montoPagado];
    creditosOtorgadosTotal = creditosComprados + CREDITOS_CORTESIA;
  } else if (PLANES_ILIMITADOS[montoPagado]) {
    tipoPlan = "ilimitado";
    duracionDias = PLANES_ILIMITADOS[montoPagado];
  } else {
    throw new Error(`Monto de pago S/ ${montoPagado} no coincide con ningún plan válido.`);
  }

  const userDataBefore = doc.data();
  const creditosAntes = userDataBefore.creditos || 0;
  
  // 3. Aplicar beneficio en una transacción
  await db.runTransaction(async (t) => {
    let updateData = {};

    if (tipoPlan === "creditos") {
      // Sumar créditos
      updateData.creditos = creditosAntes + creditosOtorgadosTotal;
      updateData.ultimaCompraCreditos = creditosOtorgadosTotal;
      updateData.tipoPlan = 'creditos_paquete';
    } else {
      // Activar plan ilimitado (lógica de extensión simplificada)
      const fechaActual = moment();
      let fechaFinActual = userDataBefore.fechaFinIlimitado ? moment(userDataBefore.fechaFinIlimitado.toDate()) : fechaActual;
      
      // Si la fecha de fin ya pasó, la nueva duración empieza hoy. Si no, extiende desde la fecha de fin actual.
      const fechaInicio = fechaFinActual.isAfter(fechaActual) ? fechaFinActual : fechaActual;
      const fechaFinNueva = fechaInicio.clone().add(duracionDias, 'days');

      updateData.fechaFinIlimitado = admin.firestore.Timestamp.fromDate(fechaFinNueva.toDate());
      updateData.duracionDias = duracionDias;
      updateData.tipoPlan = 'ilimitado';
      updateData.creditos = creditosAntes; // Mantener créditos
      updateData.ultimaCompraCreditos = 0;
    }
    
    updateData.ultimaCompraMonto = montoPagado;
    updateData.fechaUltimaCompra = admin.firestore.FieldValue.serverTimestamp();


    t.update(userDoc, updateData);
  });
  
  // 4. Generar el mensaje profesional
  let mensaje = {};
  const horaActual = moment.tz("America/Lima"); // Asume zona horaria de Perú
  let saludoTiempo = "";
  if (horaActual.hour() >= 5 && horaActual.hour() < 12) {
    saludoTiempo = "día ☀️";
  } else if (horaActual.hour() >= 12 && horaActual.hour() < 18) {
    saludoTiempo = "tarde 🌅";
  } else if (horaActual.hour() >= 18 && horaActual.hour() < 24) {
    saludoTiempo = "noche 🌙";
  } else {
    saludoTiempo = "madrugada 🦉";
  }


  if (tipoPlan === "creditos") {
    // Recargar datos para obtener el total actualizado, aunque en este punto ya lo sabemos
    const totalCreditosFinal = creditosAntes + creditosOtorgadosTotal;
    
    mensaje.titulo = `Activación Exitosa de Créditos 💳`;
    mensaje.cuerpo = `Estimada usuario(a) **${email}**, tus **${creditosComprados} créditos** por la compra de **S/${montoPagado}** fueron activados exitosamente 💳.
    
Además, decidimos premiarte con **${CREDITOS_CORTESIA} créditos extra de regalo** 🎁, porque los buenos usuarios siempre se notan 😉.
    
En total ahora tienes **${totalCreditosFinal} créditos**, incluyendo los **${creditosAntes}** que ya tenías en tu cuenta.
    
Disfrútalos, te los ganaste 😌✨
(El equipo de Consulta PE te desea una excelente ${saludoTiempo})`;
  } else {
    // Si es plan ilimitado
    const docAfter = await userDoc.get();
    const userDataAfter = docAfter.data();
    const fechaFin = moment(userDataAfter.fechaFinIlimitado.toDate()).tz("America/Lima").format("DD/MM/YYYY [a las] HH:mm");
    
    mensaje.titulo = `Plan Ilimitado Activado 🎉`;
    mensaje.cuerpo = `Estimada usuario(a) **${email}**, tu **Plan Ilimitado** por **${duracionDias} días** (compra de S/${montoPagado}) ha sido activado/extendido exitosamente.
    
Tu acceso ilimitado está garantizado hasta el **${fechaFin}**. ¡Aprovecha al máximo! 🚀
    
Tus **${creditosAntes}** créditos restantes siguen disponibles.
    
(El equipo de Consulta PE te desea una excelente ${saludoTiempo})`;
  }
  
  return {
    message: mensaje,
    tipoPlan,
    montoPagado,
  };
}

// =======================================================
// 💸 Funciones de INICIACIÓN de Pago
// (Mismas que en el original, pero con una aclaración de Yape/Tarjeta)
// =======================================================

/**
 * Crea una preferencia de pago en Mercado Pago (Incluye Yape, Tarjeta, etc. en el checkout).
 */
async function createMercadoPagoPreference(amount, uid, email, description) {
  if (!mercadopago.configurations.access_token) {
    throw new Error("Mercado Pago SDK no configurado. Falta Access Token.");
  }
  const externalReference = `MP-${uid}-${Date.now()}`;

  const preference = {
    items: [
      {
        title: description,
        unit_price: amount,
        quantity: 1,
        currency_id: "PEN", // Moneda Peruana: Soles
      },
    ],
    payer: { email: email },
    back_urls: {
      success: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&email=${email}&estado=approved&ref=${externalReference}`,
      failure: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&email=${email}&estado=rejected&ref=${externalReference}`,
      pending: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&email=${email}&estado=pending&ref=${externalReference}`,
    },
    auto_return: "approved",
    external_reference: externalReference,
    payment_methods: {
      installments: 1, 
    },
  };

  const response = await mercadopago.preferences.create(preference);
  // Retorna la URL de redirección (init_point) que incluye todas las opciones (Tarjetas, Yape, etc.)
  return response.body.init_point;
}

/**
 * Crea un pago con Flow (Incluye todas las opciones de Flow en el checkout).
 */
async function createFlowPayment(amount, uid, email, subject) {
  if (!flowClient) {
    throw new Error("Flow Client no configurado.");
  }
  const commerceOrder = `FLOW-${uid}-${Date.now()}`;

  const paymentData = {
    commerceOrder: commerceOrder,
    subject: subject,
    amount: amount,
    email: email,
    currency: "PEN", 
    // Flow requiere que la confirmación sea POST (urlConfirmation)
    urlConfirmation: `${HOST_URL}/api/flow/confirmation`, 
    urlReturn: `${HOST_URL}/api/flow?monto=${amount}&uid=${uid}&email=${email}&estado=pagado&ref=${commerceOrder}`,
  };

  const response = await flowClient.createPayment(paymentData);
  return response.url; // URL de redirección a Flow
}

// =======================================================
// 🌐 Endpoints de INICIACIÓN de Pago (Únicos y Claros)
// =======================================================

// ➡️ Endpoint Unificado para iniciar pagos con Mercado Pago (S/ 10, S/ 20)
app.get("/api/init/mercadopago/:amount", async (req, res) => {
  try {
    const amount = Number(req.params.amount);
    const { uid, email } = req.query;

    if (!uid || !email) {
      return res.status(400).json({ message: "Faltan 'uid' y 'email' en la query." });
    }
    if (![10, 20].includes(amount)) {
      return res.status(400).json({ message: "Monto no válido para Mercado Pago (solo S/ 10, S/ 20)." });
    }

    const creditos = PAQUETES_CREDITOS[amount] + CREDITOS_CORTESIA;
    const description = `Paquete de ${creditos} créditos (incl. cortesía) - S/${amount}`;

    const redirectUrl = await createMercadoPagoPreference(amount, uid, email, description);

    res.json({
      ok: true,
      processor: "Mercado Pago (Incluye Yape, Tarjetas, etc.)",
      amount: amount,
      description: description,
      redirectUrl: redirectUrl,
    });
  } catch (e) {
    console.error("Error en /api/init/mercadopago:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ➡️ Endpoint Unificado para iniciar pagos de Créditos con Flow (S/ 50, S/ 100, S/ 200)
app.get("/api/init/flow/creditos/:amount", async (req, res) => {
  try {
    const amount = Number(req.params.amount);
    const { uid, email } = req.query;

    if (!uid || !email) {
      return res.status(400).json({ message: "Faltan 'uid' y 'email' en la query." });
    }
    if (![50, 100, 200].includes(amount)) {
      return res.status(400).json({ message: "Monto no válido para Flow Créditos." });
    }

    const creditos = PAQUETES_CREDITOS[amount] + CREDITOS_CORTESIA;
    const description = `Paquete de ${creditos} créditos (incl. cortesía) - Flow`;

    const redirectUrl = await createFlowPayment(amount, uid, email, description);

    res.json({
      ok: true,
      processor: "Flow (Incluye Tarjetas, Banca, etc.)",
      amount: amount,
      description: description,
      redirectUrl: redirectUrl,
    });
  } catch (e) {
    console.error("Error en /api/init/flow/creditos:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ➡️ Endpoint Unificado para iniciar pagos de Plan Ilimitado con Flow
app.get("/api/init/flow/ilimitado/:amount", async (req, res) => {
  try {
    const amount = Number(req.params.amount);
    const { uid, email } = req.query;

    if (!uid || !email) {
      return res.status(400).json({ message: "Faltan 'uid' y 'email' en la query." });
    }
    if (!PLANES_ILIMITADOS[amount]) {
      return res.status(400).json({ message: "Monto no válido para Plan Ilimitado." });
    }

    const dias = PLANES_ILIMITADOS[amount];
    const description = `Plan Ilimitado por ${dias} días - Flow`;

    const redirectUrl = await createFlowPayment(amount, uid, email, description);

    res.json({
      ok: true,
      processor: "Flow (Incluye Tarjetas, Banca, etc.)",
      amount: amount,
      description: description,
      redirectUrl: redirectUrl,
    });
  } catch (e) {
    console.error("Error en /api/init/flow/ilimitado:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// =======================================================
// 🔔 Endpoints de Notificación/Callback (Otorga Beneficio)
// =======================================================

// ➡️ Mercado Pago (Recibe estado final del pago)
app.get("/api/mercadopago", async (req, res) => {
  const { uid, email, monto, estado } = req.query;

  try {
    console.log(`[MP Callback] UID: ${uid}, Email: ${email}, Monto: ${monto}, Estado: ${estado}`);

    if (!email || !uid || !monto) {
        return res.redirect("/payment/error?msg=Faltan_datos_en_el_callback");
    }
    
    // Solo otorgamos el beneficio si el estado es aprobado.
    if (estado !== "approved") {
      // Redirigir a una página de estado de pago pendiente/rechazado en tu app
      return res.redirect(`/payment/rejected?status=${estado}`); 
    }

    const result = await otorgarBeneficio(uid, email, Number(monto));
    // Redirigir a la página de éxito de tu app, pasando el mensaje
    const encodedMessage = encodeURIComponent(JSON.stringify(result.message));
    res.redirect(`/payment/success?msg=${encodedMessage}`);

  } catch (e) {
    console.error("Error en /api/mercadopago:", e.message);
    res.redirect(`/payment/error?msg=${encodeURIComponent(e.message)}`);
  }
});

// ➡️ Flow (Recibe estado final del pago)
app.get("/api/flow", async (req, res) => {
  const { uid, email, monto, estado } = req.query;

  try {
    console.log(`[Flow Callback] UID: ${uid}, Email: ${email}, Monto: ${monto}, Estado: ${estado}`);

    if (!email || !uid || !monto) {
        return res.redirect("/payment/error?msg=Faltan_datos_en_el_callback");
    }
    
    // El estado 'pagado' (o 'paid') es el que esperamos en el retorno del usuario.
    if (estado !== "pagado" && estado !== "paid") {
      return res.redirect(`/payment/rejected?status=${estado}`); 
    }
    
    const result = await otorgarBeneficio(uid, email, Number(monto));
    // Redirigir a la página de éxito de tu app, pasando el mensaje
    const encodedMessage = encodeURIComponent(JSON.stringify(result.message));
    res.redirect(`/payment/success?msg=${encodedMessage}`);

  } catch (e) {
    console.error("Error en /api/flow:", e.message);
    res.redirect(`/payment/error?msg=${encodeURIComponent(e.message)}`);
  }
});

// ⚠️ Endpoint de confirmación de servidor a servidor de Flow (POST)
// **Debe ser completado** con la lógica de verificación de firma de Flow.
app.post("/api/flow/confirmation", (req, res) => {
    // ⚠️ Lógica de verificación de firma y confirmación final del pago de Flow aquí
    // El SDK real se encarga de esto. Por ahora, solo respondemos 200 para no fallar.
    console.log("[Flow POST Confirmation] Recibida, pero no procesada (usar SDK real)");
    res.status(200).send("OK");
});


// Endpoint de prueba
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    firebaseInitialized: !!db,
    flowConfigured: !!FLOW_API_KEY,
    mercadopagoConfigured: !!MERCADOPAGO_ACCESS_TOKEN,
    endpoints_init: {
      mercadopago_init: `${HOST_URL}/api/init/mercadopago/:amount?uid={uid}&email={email}`,
      flow_creditos_init: `${HOST_URL}/api/init/flow/creditos/:amount?uid={uid}&email={email}`,
      flow_ilimitado_init: `${HOST_URL}/api/init/flow/ilimitado/:amount?uid={uid}&email={email}`,
    },
    endpoints_callback: {
        callback_mercadopago_redirect: `${HOST_URL}/api/mercadopago`,
        callback_flow_redirect: `${HOST_URL}/api/flow`,
        callback_flow_post: `${HOST_URL}/api/flow/confirmation`,
    }
  });
});

// =======================================================
// 🚀 Servidor
// =======================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
