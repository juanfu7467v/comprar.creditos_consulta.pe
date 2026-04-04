import axios from 'axios';
import { initFirebase, getDb } from '../shared/firebase.js';
import { sendEmailAlert, sendTelegramAlert, sendSlackAlert, sendDailyReport } from '../shared/alerts.js';
import moment from 'moment-timezone';
import https from 'https';
import tls from 'tls';

const CHECK_INTERVAL = 60 * 1000; // 1 minute base interval
const UPTIME_CALCULATION_WINDOW = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

/**
 * Main monitoring function that runs periodically
 */
async function runMonitor() {
  console.log(`[MONITOR] Starting check at ${new Date().toISOString()}`);
  const db = getDb();
  
  try {
    const monitorsSnapshot = await db.collection('pp_monitors').where('active', '==', true).get();
    
    if (monitorsSnapshot.empty) {
      console.log('[MONITOR] No active monitors found');
      return;
    }

    const promises = monitorsSnapshot.docs.map(async (doc) => {
      try {
        await checkMonitor(db, doc.id, doc.data());
      } catch (error) {
        console.error(`[MONITOR] Error checking monitor ${doc.id}:`, error);
      }
    });

    await Promise.all(promises);
  } catch (error) {
    console.error('[MONITOR] Error in monitor loop:', error);
  }
}

/**
 * Check a single monitor
 */
async function checkMonitor(db, monitorId, monitor) {
  const now = new Date();
  const lastCheck = monitor.lastCheck ? new Date(monitor.lastCheck) : new Date(0);
  const frequencyMs = (monitor.frequency || 5) * 60 * 1000;

  // Check if it's time to run based on frequency
  if (now - lastCheck < frequencyMs) {
    return;
  }

  console.log(`[MONITOR] Checking ${monitor.url} (ID: ${monitorId})`);

  let status = 'up';
  let responseTime = 0;
  let errorMessage = null;
  let sslDaysRemaining = null;

  const startTime = Date.now();

  try {
    if (monitor.type === 'ssl') {
      // SSL Certificate check
      const result = await checkSSLCertificate(monitor.url);
      status = result.status;
      errorMessage = result.error;
      sslDaysRemaining = result.daysRemaining;
      responseTime = Date.now() - startTime;
    } else {
      // HTTP(S) check
      const response = await axios.get(monitor.url, {
        timeout: 10000,
        validateStatus: () => true, // Don't throw on any status
        headers: {
          'User-Agent': 'UptimePulse/1.0 (+https://masitaprex.com)'
        }
      });

      responseTime = Date.now() - startTime;

      if (response.status < 200 || response.status >= 300) {
        status = 'down';
        errorMessage = `HTTP Status: ${response.status}`;
      }
    }
  } catch (error) {
    status = 'down';
    responseTime = Date.now() - startTime;
    errorMessage = error.message || 'Unknown error';
  }

  // Update monitor state
  const previousStatus = monitor.status || 'unknown';
  const updateData = {
    status,
    lastCheck: new Date(),
    lastResponseTime: responseTime,
    uptime: await calculateUptime(db, monitorId, monitor, status)
  };

  if (status === 'down') {
    updateData.lastDown = new Date();
  }

  if (sslDaysRemaining !== null) {
    updateData.sslDaysRemaining = sslDaysRemaining;
  }

  await db.collection('pp_monitors').doc(monitorId).update(updateData);

  // Log check in history (optimized: only if status changed or every hour)
  const shouldLog = previousStatus !== status || (now - lastCheck > 60 * 60 * 1000);
  if (shouldLog) {
    await db.collection('pp_logs').add({
      monitorId,
      status,
      responseTime,
      timestamp: new Date(),
      error: errorMessage,
      sslDaysRemaining
    });
  }

  // Handle alerts
  if (previousStatus === 'up' && status === 'down') {
    await handleAlert(db, monitor, monitorId, 'down', errorMessage);
  } else if (previousStatus === 'down' && status === 'up') {
    await handleAlert(db, monitor, monitorId, 'up');
  }

  // SSL certificate warning (alert 7 days before expiration)
  if (monitor.type === 'ssl' && sslDaysRemaining !== null && sslDaysRemaining <= 7 && sslDaysRemaining > 0) {
    await handleSSLWarning(db, monitor, sslDaysRemaining);
  }
}

/**
 * Check SSL certificate expiration
 */
async function checkSSLCertificate(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const port = urlObj.port || 443;

    return new Promise((resolve) => {
      const socket = tls.connect(port, hostname, { servername: hostname }, function() {
        const cert = socket.getPeerCertificate();
        socket.destroy();

        if (!cert || !cert.valid_to) {
          resolve({
            status: 'down',
            error: 'No valid certificate found',
            daysRemaining: null
          });
          return;
        }

        const expiryDate = new Date(cert.valid_to);
        const now = new Date();
        const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

        if (daysRemaining < 0) {
          resolve({
            status: 'down',
            error: 'Certificate expired',
            daysRemaining: 0
          });
        } else {
          resolve({
            status: 'up',
            error: null,
            daysRemaining
          });
        }
      });

      socket.on('error', (error) => {
        resolve({
          status: 'down',
          error: error.message,
          daysRemaining: null
        });
      });

      setTimeout(() => {
        socket.destroy();
        resolve({
          status: 'down',
          error: 'Connection timeout',
          daysRemaining: null
        });
      }, 10000);
    });
  } catch (error) {
    return {
      status: 'down',
      error: error.message,
      daysRemaining: null
    };
  }
}

/**
 * Calculate uptime percentage based on logs
 */
async function calculateUptime(db, monitorId, monitor, currentStatus) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - UPTIME_CALCULATION_WINDOW);
    
    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .where('timestamp', '>=', thirtyDaysAgo)
      .orderBy('timestamp', 'desc')
      .get();

    if (logsSnapshot.empty) {
      return currentStatus === 'up' ? 100 : 0;
    }

    const logs = logsSnapshot.docs.map(doc => doc.data());
    const upLogs = logs.filter(log => log.status === 'up').length;
    const totalLogs = logs.length;

    return Math.round((upLogs / totalLogs) * 100 * 100) / 100; // 2 decimal places
  } catch (error) {
    console.error('[UPTIME_CALC] Error calculating uptime:', error);
    return monitor.uptime || 100;
  }
}

/**
 * Handle status change alerts
 */
async function handleAlert(db, monitor, monitorId, newStatus, error = null) {
  const { name, url, userId, notifications } = monitor;
  console.log(`[ALERT] Monitor ${name} is ${newStatus.toUpperCase()}!`);

  try {
    // Get user subscription to determine notification channels
    const subSnapshot = await db.collection('pp_subscriptions')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    const subscription = subSnapshot.empty ? null : subSnapshot.docs[0].data();
    const plan = subscription?.plan || 'free';

    // Email alert (all plans)
    if (notifications?.email) {
      await sendEmailAlert(notifications.email, name, url, newStatus, error);
    }

    // Telegram alert (Starter and above)
    if (notifications?.telegram && ['starter', 'pro', 'business', 'agency'].includes(plan)) {
      await sendTelegramAlert(
        process.env.TELEGRAM_BOT_TOKEN,
        notifications.telegram,
        name,
        url,
        newStatus,
        error
      );
    }

    // Slack alert (Pro and above)
    if (notifications?.slack && ['pro', 'business', 'agency'].includes(plan)) {
      await sendSlackAlert(notifications.slack, name, url, newStatus, error);
    }

    // Log incident
    if (newStatus === 'down') {
      await db.collection('pp_incidents').add({
        monitorId: monitorId,
        monitorName: name,
        startTime: new Date(),
        endTime: null,
        duration: null,
        errorMessage: error,
        status: 'ongoing'
      });
    } else if (newStatus === 'up') {
      // Close any ongoing incident
      const incidentsSnapshot = await db.collection('pp_incidents')
        .where('monitorId', '==', monitorId)
        .where('status', '==', 'ongoing')
        .limit(1)
        .get();

      if (!incidentsSnapshot.empty) {
        const incident = incidentsSnapshot.docs[0];
        const startTime = new Date(incident.data().startTime);
        const duration = Date.now() - startTime.getTime();

        await db.collection('pp_incidents').doc(incident.id).update({
          endTime: new Date(),
          duration,
          status: 'resolved'
        });
      }
    }
  } catch (error) {
    console.error('[ALERT] Error handling alert:', error);
  }
}

/**
 * Handle SSL certificate warning
 */
async function handleSSLWarning(db, monitor, daysRemaining) {
  const { name, url, notifications } = monitor;
  const warningMessage = `SSL certificate will expire in ${daysRemaining} days`;

  console.log(`[SSL_WARNING] ${name}: ${warningMessage}`);

  try {
    if (notifications?.email) {
      await sendEmailAlert(
        notifications.email,
        `[SSL WARNING] ${name}`,
        url,
        'warning',
        warningMessage
      );
    }

    if (notifications?.telegram) {
      await sendTelegramAlert(
        process.env.TELEGRAM_BOT_TOKEN,
        notifications.telegram,
        `[SSL WARNING] ${name}`,
        url,
        'warning',
        warningMessage
      );
    }
  } catch (error) {
    console.error('[SSL_WARNING] Error sending SSL warning:', error);
  }
}

/**
 * Send daily reports to users
 */
async function sendDailyReports() {
  console.log('[REPORTS] Starting daily report generation');
  const db = getDb();

  try {
    const usersSnapshot = await db.collection('pp_subscriptions')
      .where('status', '==', 'active')
      .get();

    const promises = usersSnapshot.docs.map(async (doc) => {
      const subscription = doc.data();
      const userId = subscription.userId;

      try {
        // Get all monitors for this user
        const monitorsSnapshot = await db.collection('pp_monitors')
          .where('userId', '==', userId)
          .get();

        if (monitorsSnapshot.empty) return;

        const monitors = monitorsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // Calculate daily and weekly uptime for each monitor
        for (const monitor of monitors) {
          const dailyUptime = await calculateDailyUptime(db, monitor.id);
          const weeklyUptime = await calculateWeeklyUptime(db, monitor.id);

          // Get user email
          const userSnapshot = await db.collection('usuarios').doc(userId).get();
          const userEmail = userSnapshot.data()?.email;

          if (userEmail) {
            await sendDailyReport(userEmail, monitor.name, dailyUptime, weeklyUptime);
          }
        }
      } catch (error) {
        console.error('[REPORTS] Error generating report for user:', error);
      }
    });

    await Promise.all(promises);
  } catch (error) {
    console.error('[REPORTS] Error in daily reports:', error);
  }
}

/**
 * Calculate daily uptime
 */
async function calculateDailyUptime(db, monitorId) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .where('timestamp', '>=', today)
      .where('timestamp', '<', tomorrow)
      .get();

    if (logsSnapshot.empty) return 100;

    const logs = logsSnapshot.docs.map(doc => doc.data());
    const upLogs = logs.filter(log => log.status === 'up').length;
    const totalLogs = logs.length;

    return Math.round((upLogs / totalLogs) * 100 * 100) / 100;
  } catch (error) {
    console.error('[DAILY_UPTIME] Error:', error);
    return 100;
  }
}

/**
 * Calculate weekly uptime
 */
async function calculateWeeklyUptime(db, monitorId) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .where('timestamp', '>=', sevenDaysAgo)
      .get();

    if (logsSnapshot.empty) return 100;

    const logs = logsSnapshot.docs.map(doc => doc.data());
    const upLogs = logs.filter(log => log.status === 'up').length;
    const totalLogs = logs.length;

    return Math.round((upLogs / totalLogs) * 100 * 100) / 100;
  } catch (error) {
    console.error('[WEEKLY_UPTIME] Error:', error);
    return 100;
  }
}

/**
 * Schedule daily report generation
 */
function scheduleDailyReportGeneration() {
  const scheduleNextRun = () => {
    const now = new Date();
    const limaTime = moment.tz(now, 'America/Lima');
    
    // Set to 8 AM Lima time
    const nextRun = moment.tz('America/Lima').clone().hour(8).minute(0).second(0);
    
    if (nextRun.isBefore(limaTime)) {
      nextRun.add(1, 'day');
    }

    const delayMs = nextRun.diff(limaTime);
    console.log(`[REPORTS] Next daily report scheduled for ${nextRun.format('YYYY-MM-DD HH:mm:ss')} (in ${Math.round(delayMs / 1000 / 60)} minutes)`);

    setTimeout(() => {
      sendDailyReports();
      scheduleNextRun();
    }, delayMs);
  };

  scheduleNextRun();
}

/**
 * Start the worker
 */
(async () => {
  try {
    await initFirebase();
    console.log('[MONITOR] UptimePulse Worker started');

    // Run immediately then on interval
    runMonitor();
    setInterval(runMonitor, CHECK_INTERVAL);

    // Run daily reports at 8 AM Lima time
    scheduleDailyReportGeneration();
  } catch (error) {
    console.error('[MONITOR] Failed to start worker:', error);
    process.exit(1);
  }
})();
