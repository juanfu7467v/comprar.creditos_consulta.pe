const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Resend } = require('resend');

admin.initializeApp();

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Enviar correo de bienvenida cuando se crea un nuevo usuario
 */
exports.sendWelcomeEmail = functions.auth.user().onCreate(async (user) => {
  const email = user.email;
  const displayName = user.displayName || 'Usuario';

  try {
    await resend.emails.send({
      from: 'Masitaprex <bienvenida@masitaprex.com>',
      to: email,
      subject: 'Bienvenido a la Infraestructura Masitaprex',
      html: `
        <div style="background-color: #0f172a; color: #f8fafc; padding: 40px; font-family: sans-serif; border-radius: 8px;">
          <h1 style="color: #3b82f6; margin-bottom: 24px;">Bienvenido a Masitaprex</h1>
          <p style="font-size: 16px; line-height: 1.6;">Hola ${displayName},</p>
          <p style="font-size: 16px; line-height: 1.6;">Tu cuenta ha sido validada con éxito. Has ingresado a un ecosistema diseñado para la eficiencia técnica. Ya puedes gestionar tus servicios desde tu panel de control.</p>
          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #334155; font-size: 14px; color: #94a3b8;">
            <p>Atentamente,<br>El equipo de Masitaprex</p>
          </div>
        </div>
      `
    });
    console.log(`Correo de bienvenida enviado a: ${email}`);
  } catch (error) {
    console.error('Error enviando correo de bienvenida:', error);
  }
});

/**
 * Enviar alerta de seguridad cuando se detecta un nuevo dispositivo
 * Esta función se llamará manualmente desde el cliente o mediante un trigger de Firestore
 */
exports.onNewDeviceDetected = functions.firestore
  .document('users/{userId}/devices/{deviceId}')
  .onCreate(async (snapshot, context) => {
    const deviceData = snapshot.data();
    const userId = context.params.userId;
    
    try {
      const userRecord = await admin.auth().getUser(userId);
      const email = userRecord.email;
      
      const browser = deviceData.browser || 'Desconocido';
      const os = deviceData.os || 'Desconocido';
      const date = deviceData.createdAt ? deviceData.createdAt.toDate().toLocaleString('es-PE') : new Date().toLocaleString('es-PE');

      await resend.emails.send({
        from: 'Seguridad Masitaprex <no-reply@masitaprex.com>',
        to: email,
        subject: '⚠️ Alerta de seguridad: Nuevo inicio de sesión detectado',
        html: `
          <div style="background-color: #0f172a; color: #f8fafc; padding: 40px; font-family: sans-serif; border-radius: 8px;">
            <h1 style="color: #ef4444; margin-bottom: 24px;">Alerta de Seguridad</h1>
            <p style="font-size: 16px; line-height: 1.6;">Detectamos un inicio de sesión en tu cuenta desde un nuevo dispositivo o ubicación.</p>
            <div style="background-color: #1e293b; padding: 20px; border-radius: 6px; margin: 24px 0;">
              <p style="margin: 0; font-weight: bold; color: #3b82f6;">Detalles:</p>
              <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${browser} / ${os}</p>
              <p style="margin: 4px 0 0 0;"><strong>Fecha:</strong> ${date}</p>
            </div>
            <p style="font-size: 16px; line-height: 1.6;">Si fuiste tú, puedes ignorar este mensaje. Si no reconoces esta actividad, cambia tu contraseña de inmediato.</p>
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #334155; font-size: 14px; color: #94a3b8;">
              <p>Seguridad Masitaprex</p>
            </div>
          </div>
        `
      });
      console.log(`Alerta de seguridad enviada a: ${email}`);
    } catch (error) {
      console.error('Error enviando alerta de seguridad:', error);
    }
  });
