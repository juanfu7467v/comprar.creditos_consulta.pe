import express from "express";
import * as paymentController from "../controllers/paymentController.js";
import { verifyFirebaseAuth } from "../middleware/auth.js";
import logger from "../utils/logger.js";
import { db } from "../config/firebase.js";

const router = express.Router();

router.get("/health", async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  };

  if (db) {
    try {
      await db.collection('_healthcheck').doc('ping').get();
      health.services = { firestore: 'connected' };
    } catch (error) {
      health.services = { firestore: 'error', error: error.message };
      health.status = 'degraded';
    }
  }

  res.json(health);
});

router.post("/process-payment", verifyFirebaseAuth, paymentController.createPayment);
router.post("/webhook/mercadopago", paymentController.handleWebhook);

router.get("/invoice-options", (req, res) => {
  res.json({
    options: [
      { value: 'boleta', label: 'Boleta de Venta', description: 'Para personas naturales' },
      { value: 'factura', label: 'Factura', description: 'Para empresas con RUC' }
    ],
    default: 'boleta'
  });
});

export default router;
