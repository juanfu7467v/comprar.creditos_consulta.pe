# Implementación de Pagos con Mercado Pago (Checkout API)

Esta actualización implementa el flujo completo de pagos con tarjeta, activación de créditos y generación de boletas en PDF.

## 🚀 Cambios Realizados

1.  **Backend (`index.js`)**:
    *   Nuevo endpoint `/api/pay` para procesar pagos con token de tarjeta.
    *   Webhook `/api/webhook/mercadopago` para confirmación asíncrona y segura.
    *   Integración con `pdfGenerator.js` para crear boletas automáticamente tras el pago aprobado.
    *   Endpoint `/api/payment-status/:id` para que el frontend verifique la activación y obtenga el PDF.

2.  **Generador de PDF (`pdfGenerator.js`)**:
    *   Uso de `pdfkit` para generar comprobantes profesionales.
    *   Almacenamiento local en `public/invoices/` (accesible vía web).

3.  **Frontend**:
    *   `public/checkout.html`: Interfaz de tokenización segura de Mercado Pago.
    *   `paquetes.html`: Actualizado para redirigir al nuevo flujo de checkout.

## 🛠 Configuración Necesaria

Para que el sistema funcione en producción, debes configurar las siguientes variables de entorno en tu servidor (ej: Fly.io):

| Variable | Descripción |
| :--- | :--- |
| `MERCADOPAGO_ACCESS_TOKEN` | Tu Access Token de producción de Mercado Pago. |
| `HOST_URL` | La URL pública de tu servidor (ej: `https://tu-app.fly.dev`). |
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la cuenta de servicio de Firebase. |

### Configuración en el Frontend
En `public/checkout.html`, busca la línea:
```javascript
const mp = new MercadoPago('YOUR_PUBLIC_KEY');
```
Reemplaza `'YOUR_PUBLIC_KEY'` por tu **Public Key** de Mercado Pago.

## 🔒 Seguridad
*   El **Access Token** nunca se expone al cliente.
*   Los créditos solo se activan mediante el **Webhook** tras la confirmación de Mercado Pago.
*   Se utiliza **idempotencia** para evitar duplicidad de créditos si el webhook se recibe varias veces.

## 📦 Instalación de Dependencias
Si vas a desplegar manualmente, asegúrate de instalar las nuevas dependencias:
```bash
npm install pdfkit mercadopago axios moment-timezone
```
