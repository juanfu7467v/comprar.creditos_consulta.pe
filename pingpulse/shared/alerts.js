import axios from 'axios';
import { Resend } from 'resend';
import moment from 'moment-timezone';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email alert via Resend
 */
export async function sendEmailAlert(email, monitorName, url, status, error = null) {
  const context = 'EMAIL_ALERT';
  try {
    const statusEmoji = status === 'down' ? '🚨' : status === 'up' ? '✅' : '⚠️';
    const statusText = status === 'down' ? 'CAÍDO' : status === 'up' ? 'OPERATIVO' : 'ADVERTENCIA';
    const timestamp = moment().tz('America/Lima').format('YYYY-MM-DD HH:mm:ss');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
            .header { padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 30px; }
            .alert-box { padding: 15px; border-radius: 6px; margin: 20px 0; }
            .alert-down { background-color: #fee; border-left: 4px solid #f44; }
            .alert-up { background-color: #efe; border-left: 4px solid #4f4; }
            .alert-warning { background-color: #fef3cd; border-left: 4px solid #ffc107; }
            .alert-box strong { display: block; margin-bottom: 10px; }
            .details { background-color: #f9f9f9; padding: 15px; border-radius: 4px; margin: 15px 0; font-size: 14px; }
            .details-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
            .details-row:last-child { border-bottom: none; }
            .label { font-weight: 600; color: #666; }
            .value { color: #333; }
            .footer { padding: 20px; background-color: #f9f9f9; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #eee; }
            .button { display: inline-block; padding: 10px 20px; background-color: #667eea; color: white; text-decoration: none; border-radius: 4px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${statusEmoji} Alerta de Monitor UptimePulse</h1>
            </div>
            <div class="content">
              <p>Hola,</p>
              <p>Tu monitor <strong>${monitorName}</strong> ha cambiado de estado.</p>
              
              <div class="alert-box alert-${status}">
                <strong>Estado: ${statusText}</strong>
                <p>${status === 'down' ? 'Tu servicio está actualmente caído. Por favor, verifica la situación.' : status === 'up' ? 'Tu servicio está operativo nuevamente.' : 'Se ha detectado una advertencia en tu servicio.'}</p>
              </div>

              <div class="details">
                <div class="details-row">
                  <span class="label">Monitor:</span>
                  <span class="value">${monitorName}</span>
                </div>
                <div class="details-row">
                  <span class="label">URL:</span>
                  <span class="value">${url}</span>
                </div>
                <div class="details-row">
                  <span class="label">Estado:</span>
                  <span class="value">${statusText}</span>
                </div>
                ${error ? `<div class="details-row">
                  <span class="label">Error:</span>
                  <span class="value">${error}</span>
                </div>` : ''}
                <div class="details-row">
                  <span class="label">Hora:</span>
                  <span class="value">${timestamp} (PET)</span>
                </div>
              </div>

              <p>
                <a href="https://www.masitaprex.com/UptimePulse" class="button">Ver Dashboard</a>
              </p>
            </div>
            <div class="footer">
              <p>© 2024 UptimePulse - Monitoreo de APIs y Páginas Web</p>
              <p>Recibiste este correo porque estás suscrito a alertas de UptimePulse.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const response = await resend.emails.send({
      from: 'UptimePulse Alerts <alerts@masitaprex.com>',
      to: email,
      subject: `${statusEmoji} UptimePulse: ${monitorName} está ${statusText}`,
      html: htmlContent
    });

    console.log(`[${context}] Email sent successfully to ${email}`);
    return { success: true, messageId: response.id };
  } catch (error) {
    console.error(`[${context}] Error sending email:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send Telegram alert via webhook
 */
export async function sendTelegramAlert(telegramBotToken, chatId, monitorName, url, status, error = null) {
  const context = 'TELEGRAM_ALERT';
  try {
    const statusEmoji = status === 'down' ? '🚨' : status === 'up' ? '✅' : '⚠️';
    const statusText = status === 'down' ? 'CAÍDO' : status === 'up' ? 'OPERATIVO' : 'ADVERTENCIA';
    const timestamp = moment().tz('America/Lima').format('YYYY-MM-DD HH:mm:ss');

    const message = `
${statusEmoji} *Alerta UptimePulse*

*Monitor:* ${monitorName}
*URL:* \`${url}\`
*Estado:* ${statusText}
${error ? `*Error:* ${error}` : ''}
*Hora:* ${timestamp} (PET)
    `.trim();

    const response = await axios.post(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      },
      { timeout: 10000 }
    );

    console.log(`[${context}] Telegram message sent successfully`);
    return { success: true, messageId: response.data.result.message_id };
  } catch (error) {
    console.error(`[${context}] Error sending Telegram message:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send Slack alert via webhook
 */
export async function sendSlackAlert(webhookUrl, monitorName, url, status, error = null) {
  const context = 'SLACK_ALERT';
  try {
    const statusEmoji = status === 'down' ? '🚨' : status === 'up' ? '✅' : '⚠️';
    const statusText = status === 'down' ? 'CAÍDO' : status === 'up' ? 'OPERATIVO' : 'ADVERTENCIA';
    const statusColor = status === 'down' ? 'danger' : status === 'up' ? 'good' : 'warning';
    const timestamp = moment().tz('America/Lima').format('YYYY-MM-DD HH:mm:ss');

    const payload = {
      attachments: [
        {
          color: statusColor,
          title: `${statusEmoji} Monitor ${statusText}`,
          fields: [
            {
              title: 'Monitor',
              value: monitorName,
              short: true
            },
            {
              title: 'URL',
              value: url,
              short: false
            },
            {
              title: 'Estado',
              value: statusText,
              short: true
            },
            ...(error ? [{
              title: 'Error',
              value: error,
              short: false
            }] : []),
            {
              title: 'Hora',
              value: timestamp + ' (PET)',
              short: true
            }
          ],
          footer: 'UptimePulse',
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    const response = await axios.post(webhookUrl, payload, { timeout: 10000 });
    console.log(`[${context}] Slack message sent successfully`);
    return { success: true };
  } catch (error) {
    console.error(`[${context}] Error sending Slack message:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send daily uptime report
 */
export async function sendDailyReport(email, monitorName, dailyUptime, weeklyUptime) {
  const context = 'DAILY_REPORT';
  try {
    const timestamp = moment().tz('America/Lima').format('YYYY-MM-DD');
    const yesterdayDate = moment().tz('America/Lima').subtract(1, 'day').format('DD/MM/YYYY');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
            .header { padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 30px; }
            .stats { display: flex; justify-content: space-around; margin: 30px 0; }
            .stat-box { text-align: center; padding: 20px; background-color: #f9f9f9; border-radius: 8px; flex: 1; margin: 0 10px; }
            .stat-value { font-size: 36px; font-weight: bold; color: #667eea; margin: 10px 0; }
            .stat-label { font-size: 14px; color: #666; margin-top: 10px; }
            .message { padding: 15px; background-color: #efe; border-left: 4px solid #4f4; border-radius: 4px; margin: 20px 0; }
            .footer { padding: 20px; background-color: #f9f9f9; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #eee; }
            .button { display: inline-block; padding: 10px 20px; background-color: #667eea; color: white; text-decoration: none; border-radius: 4px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📊 Reporte Diario de UptimePulse</h1>
            </div>
            <div class="content">
              <p>Hola,</p>
              <p>Aquí está tu reporte de monitoreo para <strong>${monitorName}</strong> del <strong>${yesterdayDate}</strong>.</p>

              <div class="stats">
                <div class="stat-box">
                  <div class="stat-label">Uptime Ayer</div>
                  <div class="stat-value">${dailyUptime}%</div>
                </div>
                <div class="stat-box">
                  <div class="stat-label">Uptime Semanal</div>
                  <div class="stat-value">${weeklyUptime}%</div>
                </div>
              </div>

              <div class="message">
                <strong>✅ ¡Excelente!</strong> Tu sistema ha funcionado correctamente durante el período reportado.
              </div>

              <p>
                <a href="https://www.masitaprex.com/UptimePulse" class="button">Ver Detalles en Dashboard</a>
              </p>

              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

              <p style="font-size: 12px; color: #999;">
                Este es un reporte automático generado por UptimePulse. Los datos se basan en los monitoreos realizados durante el período especificado.
              </p>
            </div>
            <div class="footer">
              <p>© 2024 UptimePulse - Monitoreo de APIs y Páginas Web</p>
              <p>Recibiste este correo porque estás suscrito a reportes de UptimePulse.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const response = await resend.emails.send({
      from: 'UptimePulse Reports <reports@masitaprex.com>',
      to: email,
      subject: `📊 Reporte Diario: ${monitorName} - ${dailyUptime}% uptime`,
      html: htmlContent
    });

    console.log(`[${context}] Daily report sent to ${email}`);
    return { success: true, messageId: response.id };
  } catch (error) {
    console.error(`[${context}] Error sending daily report:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send weekly summary report
 */
export async function sendWeeklySummary(email, monitorName, weeklyUptime, incidents) {
  const context = 'WEEKLY_SUMMARY';
  try {
    const weekStartDate = moment().tz('America/Lima').subtract(7, 'days').format('DD/MM/YYYY');
    const weekEndDate = moment().tz('America/Lima').format('DD/MM/YYYY');

    const incidentsHtml = incidents.length > 0 ? `
      <h3>Incidentes Reportados:</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background-color: #f0f0f0;">
          <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Fecha</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Duración</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Error</th>
        </tr>
        ${incidents.map(incident => `
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">${moment(incident.startTime).tz('America/Lima').format('DD/MM HH:mm')}</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${Math.round(incident.duration / 1000 / 60)} min</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${incident.errorMessage || 'N/A'}</td>
          </tr>
        `).join('')}
      </table>
    ` : '<p>No hubo incidentes durante esta semana. ¡Excelente!</p>';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
            .header { padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 30px; }
            .stat-box { text-align: center; padding: 20px; background-color: #f9f9f9; border-radius: 8px; margin: 20px 0; }
            .stat-value { font-size: 48px; font-weight: bold; color: #667eea; }
            .stat-label { font-size: 14px; color: #666; margin-top: 10px; }
            .footer { padding: 20px; background-color: #f9f9f9; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #eee; }
            .button { display: inline-block; padding: 10px 20px; background-color: #667eea; color: white; text-decoration: none; border-radius: 4px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📈 Resumen Semanal de UptimePulse</h1>
            </div>
            <div class="content">
              <p>Hola,</p>
              <p>Aquí está tu resumen semanal para <strong>${monitorName}</strong> del <strong>${weekStartDate}</strong> al <strong>${weekEndDate}</strong>.</p>

              <div class="stat-box">
                <div class="stat-label">Uptime Semanal</div>
                <div class="stat-value">${weeklyUptime}%</div>
              </div>

              ${incidentsHtml}

              <p>
                <a href="https://www.masitaprex.com/UptimePulse" class="button">Ver Detalles Completos</a>
              </p>
            </div>
            <div class="footer">
              <p>© 2024 UptimePulse - Monitoreo de APIs y Páginas Web</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const response = await resend.emails.send({
      from: 'UptimePulse Reports <reports@masitaprex.com>',
      to: email,
      subject: `📈 Resumen Semanal: ${monitorName} - ${weeklyUptime}% uptime`,
      html: htmlContent
    });

    console.log(`[${context}] Weekly summary sent to ${email}`);
    return { success: true, messageId: response.id };
  } catch (error) {
    console.error(`[${context}] Error sending weekly summary:`, error.message);
    return { success: false, error: error.message };
  }
}
