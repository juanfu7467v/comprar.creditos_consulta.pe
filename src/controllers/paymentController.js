import { MercadoPagoConfig, Payment } from "mercadopago";
import { otorgarBeneficio } from "../services/benefitService.js";
import logger from "../utils/logger.js";

const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const mpClient = MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({
  accessToken: MERCADOPAGO_ACCESS_TOKEN,
  options: { timeout: 15000, idempotencyKey: 'mp-payment-' + Date.now() }
}) : null;

export const createPayment = async (req, res) => {
  const context = 'CREATE_PAYMENT';
  const startTime = Date.now();

  if (!mpClient) {
    logger.error(context, 'Mercado Pago no configurado');
    return res.status(500).json({ error: 'Mercado Pago configuration missing' });
  }

  try {
    const { 
      transaction_amount: amount, 
      token, 
      description, 
      installments, 
      payment_method_id, 
      issuer_id, 
      payer,
      identificationType,
      identificationNumber
    } = req.body;

    const uid = req.uid;
    const email = payer?.email || req.user?.email;

    if (!amount || !token || !payment_method_id || !email) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos para el pago' });
    }

    const payment = new Payment(mpClient);
    const paymentData = {
      body: {
        transaction_amount: Number(amount),
        token,
        description: description || 'Créditos Consulta PE',
        installments: Number(installments) || 1,
        payment_method_id,
        issuer_id: issuer_id ? Number(issuer_id) : undefined,
        payer: {
          email: email,
          identification: {
            type: identificationType || 'DNI',
            number: identificationNumber
          }
        },
        notification_url: `${process.env.HOST_URL}/api/webhook/mercadopago`,
        metadata: { uid, email, amount, timestamp: new Date().toISOString(), source: 'direct_payment' }
      }
    };

    const result = await payment.create(paymentData);

    if (result.status === 'approved') {
      const beneficioResult = await otorgarBeneficio(
        uid,
        email,
        Number(amount),
        'MP_CARD_INSTANT',
        result.id.toString()
      );
      result.beneficioOtorgado = beneficioResult.status === 'success' || beneficioResult.status === 'already_processed';
    }

    res.json(result);

  } catch (error) {
    logger.error(context, 'Error procesando pago', error);
    res.status(400).json({ error: 'Error procesando el pago', details: error.message });
  }
};

export const handleWebhook = async (req, res) => {
  const context = 'WEBHOOK_MP';
  const webhookData = req.body;

  logger.info(context, '📩 Webhook recibido', { id: webhookData.data?.id });
  res.sendStatus(200);

  if (!mpClient) return;

  const isPaymentEvent = webhookData.action?.includes('payment') || webhookData.type === 'payment';
  if (isPaymentEvent) {
    try {
      const paymentId = webhookData.data?.id || webhookData.id;
      if (!paymentId) return;

      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      if (paymentInfo.status === "approved") {
        const { uid, email, amount } = paymentInfo.metadata || {};
        if (uid) {
          await otorgarBeneficio(uid, email || paymentInfo.payer?.email, Number(amount || paymentInfo.transaction_amount), 'MP_WEBHOOK', paymentId.toString());
        }
      }
    } catch (error) {
      logger.error(context, '❌ Error procesando webhook', error);
    }
  }
};
