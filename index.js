import express from "express";
import admin from "firebase-admin";
import cors from "cors";
import moment from "moment-timezone"; 
import axios from "axios"; 
import crypto from "crypto"; // Lo mantenemos por si acaso, aunque no se use en MP.

// Dependencias de Pago
import { MercadoPagoConfig, Preference } from "mercadopago"; 

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
// 💳 Configuración de Pago y GitHub
// =======================================================
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

// URL de Fly.io
const HOST_URL = process.env.HOST_URL || "https://pago-planes-consulta-pe.fly.dev"; 

// Variables de GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // Formato: 'usuario/repositorio'
const GITHUB_FILE_PATH = 'public/compras_exitosas.log'; // Archivo donde se guardarán las compras

if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("⚠️ Variables GITHUB_TOKEN o GITHUB_REPO no configuradas. El guardado en GitHub estará deshabilitado.");
}

// Inicialización de Mercado Pago
let mpClient;
if (MERCADOPAGO_ACCESS_TOKEN) {
  mpClient = new MercadoPagoConfig({ 
    accessToken: MERCADOPAGO_ACCESS_TOKEN,
  });
  console.log("🟢 Mercado Pago SDK configurado.");
} else {
  console.warn("⚠️ MERCADOPAGO_ACCESS_TOKEN no encontrado.");
}


// =======================================================
// 🎯 Configuración de paquetes de créditos y planes
// =======================================================
// Monto como llave, Créditos/Días como valor
const PAQUETES_CREDITOS = {
  10: 60,
  20: 125, 
  50: 330, 
  100: 700, 
  200: 1500, 
};

// Monto como llave, Días de plan como valor
const PLANES_ILIMITADOS = {
  60: 7,
  80: 15, 
  110: 30, 
  160: 60, 
  510: 70,
};

// =======================================================
// 🎁 Función para calcular créditos de cortesía
// =======================================================
/**
 * Calcula los créditos de cortesía basados en el número de compras exitosas.
 * @param {number} numComprasExitosa - El número de compras que lleva el usuario (antes de esta compra).
 * @returns {number} - Créditos de cortesía a otorgar.
 */
function calcularCreditosCortesia(numComprasExitosa) {
    const creditosBase = 2;
    let creditos = creditosBase + numComprasExitosa;
    return Math.min(creditos, 5); 
}

// =======================================================
// 💾 Función para guardar datos en GitHub
// =======================================================
/**
 * Guarda los detalles de la compra en un archivo log en GitHub.
 */
async function savePurchaseToGithub(uid, email, montoPagado, processor, numCompras) {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.warn("❌ Guardado en GitHub omitido: Faltan variables de entorno.");
        return;
    }
    
    const githubApiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
    const purchaseLog = `${moment().tz("America/Lima").format('YYYY-MM-DD HH:mm:ss')} | UID: ${uid} | Email: ${email} | Monto: S/${montoPagado} | Procesador: ${processor} | Compra #: ${numCompras}\n`;

    try {
        let sha = null;
        let existingContent = "";

        try {
            const response = await axios.get(githubApiUrl, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });
            sha = response.data.sha;
            existingContent = Buffer.from(response.data.content, 'base64').toString('utf8');
        } catch (error) {
            // Si es un error 404, el archivo no existe, lo creamos después.
            if (error.response && error.response.status !== 404) {
                 throw error;
            }
        }
        
        const newContent = existingContent + purchaseLog;
        const contentBase64 = Buffer.from(newContent, 'utf8').toString('base64');

        const commitMessage = `Log de Compra: ${email} - S/${montoPagado} (${processor})`;
        
        await axios.put(githubApiUrl, {
            message: commitMessage,
            content: contentBase64,
            sha: sha
        }, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });

        console.log(`✅ Compra de ${email} registrada en GitHub con éxito.`);

    } catch (e) {
        console.error(`❌ Error al guardar en GitHub: ${e.message}`);
        if (e.response) {
            console.error("Detalle del error de GitHub:", e.response.data);
        }
    }
}


// =======================================================
// 💎 Función para otorgar créditos o plan ilimitado y generar mensaje
// =======================================================
/**
 * Otorga el beneficio (créditos o plan) al usuario después de la confirmación de pago.
 */
async function otorgarBeneficio(uid, email, montoPagado, processor) {
  if (!db) throw new Error("Firestore no inicializado.");

  const usuariosRef = db.collection("usuarios");
  let userDoc = usuariosRef.doc(uid); 

  const doc = await userDoc.get();
  if (!doc.exists) throw new Error("Documento de usuario no existe en Firestore.");

  const userDataBefore = doc.data();
  const creditosAntes = userDataBefore.creditos || 0;
  const comprasAntes = userDataBefore.numComprasExitosa || 0;
  
  // 1. Determinar el beneficio
  let tipoPlan = "";
  let creditosComprados = 0;
  let creditosCortesia = 0;
  let creditosOtorgadosTotal = 0;
  let duracionDias = 0;
  let isCreditos = PAQUETES_CREDITOS[montoPagado];
  let isIlimitado = PLANES_ILIMITADOS[montoPagado];


  if (isCreditos) {
    tipoPlan = "creditos";
    creditosComprados = PAQUETES_CREDITOS[montoPagado];
    
    // Lógica de cortesía progresiva
    creditosCortesia = calcularCreditosCortesia(comprasAntes);
    
    creditosOtorgadosTotal = creditosComprados + creditosCortesia;
  } else if (isIlimitado) {
    tipoPlan = "ilimitado";
    duracionDias = PLANES_ILIMITADOS[montoPagado];
  } else {
    throw new Error(`Monto de pago S/ ${montoPagado} no coincide con ningún plan válido.`);
  }

  // 2. Aplicar beneficio en una transacción
  const numComprasNueva = comprasAntes + 1;
  await db.runTransaction(async (t) => {
    let updateData = {};

    if (tipoPlan === "creditos") {
      updateData.creditos = creditosAntes + creditosOtorgadosTotal;
      updateData.ultimaCompraCreditos = creditosOtorgadosTotal;
      updateData.tipoPlan = 'creditos_paquete';
    } else {
      // Lógica de extensión de plan ilimitado
      const fechaActual = moment();
      let fechaFinActual = userDataBefore.fechaFinIlimitado ? moment(userDataBefore.fechaFinIlimitado.toDate()) : fechaActual;
      const fechaInicio = fechaFinActual.isAfter(fechaActual) ? fechaFinActual : fechaActual;
      const fechaFinNueva = fechaInicio.clone().add(duracionDias, 'days');

      updateData.fechaFinIlimitado = admin.firestore.Timestamp.fromDate(fechaFinNueva.toDate());
      updateData.duracionDias = duracionDias;
      updateData.tipoPlan = 'ilimitado';
      updateData.creditos = creditosAntes; // Los créditos anteriores se mantienen
      updateData.ultimaCompraCreditos = 0;
    }
    
    updateData.numComprasExitosa = numComprasNueva;
    updateData.ultimaCompraMonto = montoPagado;
    updateData.fechaUltimaCompra = admin.firestore.FieldValue.serverTimestamp();

    t.update(userDoc, updateData);
  });
  
  // 3. Registrar la compra en GitHub (no bloqueante)
  savePurchaseToGithub(uid, email, montoPagado, processor, numComprasNueva);

  // 4. Generar el mensaje profesional
  let mensaje = {};
  const horaActual = moment.tz("America/Lima");
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
    const totalCreditosFinal = creditosAntes + creditosOtorgadosTotal;
    
    mensaje.titulo = `Activación Exitosa de Créditos 💳`;
    mensaje.cuerpo = `Estimada usuario(a) **${email}**, tus **${creditosComprados} créditos** por la compra de **S/${montoPagado}** fueron activados exitosamente 💳.
    
Además, decidimos premiarte con **${creditosCortesia} créditos extra de regalo** 🎁, porque los buenos usuarios siempre se notan 😉. (¡Es tu compra #${numComprasNueva}!)
    
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
    
Tus **${creditosAntes}** créditos restantes siguen disponibles. (¡Es tu compra #${numComprasNueva}!)
    
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
// =======================================================

/**
 * Crea una preferencia de pago en Mercado Pago.
 */
async function createMercadoPagoPreference(amount, uid, email, description) {
  if (!mpClient) {
    throw new Error("Mercado Pago SDK no configurado. Falta Access Token.");
  }
  
  const externalReference = `MP-${uid}-${Date.now()}`;
  const preference = new Preference(mpClient); 

  const response = await preference.create({
    body: {
      items: [{ title: description, unit_price: amount, quantity: 1, currency_id: "PEN" }],
      payer: { email: email },
      // Usa HOST_URL para las URLs de retorno
      back_urls: {
        success: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&email=${email}&estado=approved&ref=${externalReference}`,
        failure: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&email=${email}&estado=rejected&ref=${externalReference}`,
        pending: `${HOST_URL}/api/mercadopago?monto=${amount}&uid=${uid}&email=${email}&estado=pending&ref=${externalReference}`,
      },
      auto_return: "approved",
      external_reference: externalReference,
      payment_methods: { installments: 1 },
    }
  });
  
  // Retorna la URL de redirección (init_point)
  return response.init_point;
}


// =======================================================
// 🌐 Endpoints de INICIACIÓN de Pago 
// =======================================================

/**
 * 💡 IMPORTANTE: Este endpoint usa :amount como un parámetro de ruta
 * para ser compatible con la estructura de tu API.
 * * Ejemplo de llamada: GET /api/init/mercadopago/50?uid=ABC&email=test@mail.com
 */
app.get("/api/init/mercadopago/:amount", async (req, res) => {
  try {
    const amount = Number(req.params.amount);
    const { uid, email } = req.query;

    if (!uid || !email) return res.status(400).json({ message: "Faltan 'uid' y 'email' en la query." });
    
    // Obtener todos los montos válidos para verificación
    const creditosMontos = Object.keys(PAQUETES_CREDITOS).map(m => Number(m));
    const ilimitadoMontos = Object.keys(PLANES_ILIMITADOS).map(m => Number(m));
    const montosValidos = new Set([...creditosMontos, ...ilimitadoMontos]);

    if (!montosValidos.has(amount)) {
        return res.status(400).json({ 
            message: `Monto S/ ${amount} no válido. Los montos válidos son: ${[...montosValidos].sort((a,b) => a-b).join(', ')}.` 
        });
    }

    let description = "";
    if (PAQUETES_CREDITOS[amount]) {
        // Es un paquete de créditos
        const creditos = PAQUETES_CREDITOS[amount]; 
        description = `Paquete de ${creditos} créditos (S/${amount})`;
    } else if (PLANES_ILIMITADOS[amount]) {
        // Es un plan ilimitado
        const dias = PLANES_ILIMITADOS[amount];
        description = `Plan Ilimitado por ${dias} días (S/${amount})`;
    } else {
        // Debería ser atrapado por la verificación de montos, pero como fallback
        description = `Compra de S/${amount}`;
    }
    
    const redirectUrl = await createMercadoPagoPreference(amount, uid, email, description);

    res.json({ ok: true, processor: "Mercado Pago", amount: amount, description: description, redirectUrl: redirectUrl });
  } catch (e) {
    console.error("Error en /api/init/mercadopago:", e.message);
    res.status(500).json({ error: e.message });
  }
});


// =======================================================
// 🔔 Endpoints de Notificación/Callback (Otorga Beneficio)
// =======================================================

// ➡️ Mercado Pago (Recibe estado final del pago)
app.get("/api/mercadopago", async (req, res) => {
  // Nota: MP puede enviar notificaciones por GET o POST. Este es el callback de retorno del usuario (GET).
  const { uid, email, monto, estado } = req.query;

  try {
    if (!email || !uid || !monto) return res.redirect("/payment/error?msg=Faltan_datos_en_el_callback");
    
    if (estado !== "approved") return res.redirect(`/payment/rejected?status=${estado}`); 

    // Otorga el beneficio SOLO si el estado es 'approved'
    const result = await otorgarBeneficio(uid, email, Number(monto), 'Mercado Pago');
    
    const encodedMessage = encodeURIComponent(JSON.stringify(result.message));
    res.redirect(`/payment/success?msg=${encodedMessage}`);

  } catch (e) {
    console.error("Error en /api/mercadopago:", e.message);
    // Redirección a la URL de error, incluyendo el mensaje para debug
    res.redirect(`/payment/error?msg=${encodeURIComponent(e.message)}`);
  }
});


// Endpoint de prueba
app.get("/", (req, res) => {
  const creditosMontos = Object.keys(PAQUETES_CREDITOS).map(m => Number(m));
  const ilimitadoMontos = Object.keys(PLANES_ILIMITADOS).map(m => Number(m));
  const todosLosMontos = new Set([...creditosMontos, ...ilimitadoMontos]);
  
  res.json({
    status: "ok",
    firebaseInitialized: !!db,
    githubLogging: !!(GITHUB_TOKEN && GITHUB_REPO),
    HOST_URL_USED: HOST_URL, // Muestra la URL que se está usando
    processor: "MERCADO PAGO (Único)",
    montos_validos: [...todosLosMontos].sort((a,b) => a-b),
    endpoints_init: {
      // Endpoint único para todos los pagos con Mercado Pago
      mercadopago_init: `${HOST_URL}/api/init/mercadopago/:amount?uid={uid}&email={email}`,
    }
  });
});

// =======================================================
// 🚀 Servidor
// =======================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Servidor corriendo en puerto ${PORT} usando HOST_URL: ${HOST_URL}`));

