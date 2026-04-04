import { Resend } from 'resend';
import axios from 'axios';
import moment from 'moment-timezone';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email alert via Resend
 */
export async function sendEmailAlert(email, monitorName, url, status, error = null) {
  const context = 'EMAIL_ALERT';

  try {
    const statusEmoji = status === 'down' ? '🚨' : '✅';
    const statusText = status === 'down' ? 'CAÍDO' : 'OPERATIVO';
    const timestamp = moment().tz('America/Lima').format('YYYY-MM-DD HH:mm:ss');

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 8px; }
            .header { text-align: center; margin-bottom: 20px; }
            .status-badge { 
              display: inline-block; 
              padding: 10px 20px; 
              border-radius: 4px; 
              font-weight: bold; 
              font-size: 18px;
              margin: 10px 0;
            }
            .status-down { background-color: #fee2e2; color: #991b1b; }
            .status-up { background-color: #dcfce7; color: #166534; }
            .details { margin: 20px 0; }
            .detail-row { margin: 10px 0; }
            .label { font-weight: bold; color: #333; }
            .footer { text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Alerta de PingPulse</h1>
            </div>
            <div class="status-badge status-${status}">
              ${statusEmoji} Monitor ${statusText}
            </div>
            <div class="details">
              <div class="detail-row">
                <span class="label">Monitor:</span> ${monitorName}
              </div>
              <div class="detail-row">
                <span class="label">URL:</span> ${url}
              </div>
              <div class="detail-row">
                <span class="label">Estado:</span> ${statusText}
              </div>
              ${error ? `<div class="detail-row"><span class="label">Error:</span> ${error}</div>` : ''}
              <div class="detail-row">
                <span class="label">Hora:</span> ${timestamp} (PET)
              </div>
            </div>
            <div class="footer">
              <p>Monitoreado por <strong>PingPulse</strong></p>
              <p><a href="https://masitaprex.com/pingpulse-dashboard.html">Ver Dashboard</a></p>
            </div>
          </div>
        </body>
      </html>
    `;

    const result = await resend.emails.send({
      from: 'PingPulse Alerts <alerts@masitaprex.com>',
      to: email,
      subject: `${statusEmoji} PingPulse: ${monitorName} está ${statusText}`,
      html: htmlContent
    });

    console.log(`[${context}] Email sent successfully to ${email}`);
    return { success: true, messageId: result.id };
  } catch (error) {
    console.error(`[${context}] Error sending email:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Send Telegram alert via webhook
 */
export async function sendTelegramAlert(telegramBotToken, chatId, monitorName, url, status, error = null) {
  const context = 'TELEGRAM_ALERT';

  try {
    const statusEmoji = status === 'down' ? '🚨' : '✅';
    const statusText = status === 'down' ? 'CAÍDO' : 'OPERATIVO';
    const timestamp = moment().tz('America/Lima').format('YYYY-MM-DD HH:mm:ss');

    const message = `
${statusEmoji} *Alerta PingPulse*

*Monitor:* ${monitorName}
*URL:* ${url}
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
    const statusEmoji = status === 'down' ? '🚨' : '✅';
    const statusText = status === 'down' ? 'CAÍDO' : 'OPERATIVO';
    const statusColor = status === 'down' ? 'danger' : 'good';
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
          footer: 'PingPulse',
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

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 8px; }
            .header { text-align: center; margin-bottom: 20px; }
            .stats { display: flex; justify-content: space-around; margin: 20px 0; }
            .stat-box { text-align: center; padding: 15px; background-color: #f0f0f0; border-radius: 4px; }
            .stat-value { font-size: 24px; font-weight: bold; color: #10b981; }
            .stat-label { font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📊 Reporte Diario de PingPulse</h1>
              <p>${timestamp}</p>
            </div>
            <h2>${monitorName}</h2>
            <div class="stats">
              <div class="stat-box">
                <div class="stat-value">${dailyUptime}%</div>
                <div class="stat-label">Uptime Hoy</div>
              </div>
              <div class="stat-box">
                <div class="stat-value">${weeklyUptime}%</div>
                <div class="stat-label">Uptime Semanal</div>
              </div>
            </div>
            <p>Tu sistema ha funcionado correctamente durante el período reportado. ¡Excelente!</p>
          </div>
        </body>
      </html>
    `;

    const result = await resend.emails.send({
      from: 'PingPulse Reports <reports@masitaprex.com>',
      to: email,
      subject: `📊 Reporte Diario: ${monitorName}`,
      html: htmlContent
    });

    console.log(`[${context}] Daily report sent to ${email}`);
    return { success: true, messageId: result.id };
  } catch (error) {
    console.error(`[${context}] Error sending daily report:`, error);
    return { success: false, error: error.message };
  }
}
