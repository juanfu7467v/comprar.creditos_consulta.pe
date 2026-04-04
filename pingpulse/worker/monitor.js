import axios from 'axios';
import { initFirebase, getDb } from '../shared/firebase.js';
import { Resend } from 'resend';
import moment from 'moment-timezone';

const resend = new Resend(process.env.RESEND_API_KEY);

const CHECK_INTERVAL = 60 * 1000; // 1 minute

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
      const monitor = doc.data();
      const monitorId = doc.id;
      const now = new Date();

      // Check if it's time to run based on frequency
      const lastCheck = monitor.lastCheck ? monitor.lastCheck.toDate() : new Date(0);
      const frequencyMs = (monitor.frequency || 5) * 60 * 1000;

      if (now - lastCheck < frequencyMs) {
        return;
      }

      console.log(`[MONITOR] Checking ${monitor.url} (ID: ${monitorId})`);
      
      let status = 'up';
      let responseTime = 0;
      let errorMessage = null;
      const startTime = Date.now();

      try {
        const response = await axios.get(monitor.url, { timeout: 10000 });
        responseTime = Date.now() - startTime;
        
        if (response.status < 200 || response.status >= 300) {
          status = 'down';
          errorMessage = `HTTP Status: ${response.status}`;
        }
      } catch (error) {
        status = 'down';
        responseTime = Date.now() - startTime;
        errorMessage = error.message;
      }

      // Update monitor state
      const previousStatus = monitor.status || 'unknown';
      
      const updateData = {
        status,
        lastCheck: admin.firestore.FieldValue.serverTimestamp(),
        lastResponseTime: responseTime,
        uptime: calculateUptime(monitor, status)
      };

      if (status === 'down') {
        updateData.lastDown = admin.firestore.FieldValue.serverTimestamp();
      }

      await db.collection('pp_monitors').doc(monitorId).update(updateData);

      // Log check in history (optimized: only if status changed or every hour)
      const shouldLog = previousStatus !== status || (now - lastCheck > 60 * 60 * 1000);
      if (shouldLog) {
        await db.collection('pp_logs').add({
          monitorId,
          status,
          responseTime,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          error: errorMessage
        });
      }

      // Handle alerts
      if (previousStatus === 'up' && status === 'down') {
        await handleAlert(monitor, 'down', errorMessage);
      } else if (previousStatus === 'down' && status === 'up') {
        await handleAlert(monitor, 'up');
      }
    });

    await Promise.all(promises);
  } catch (error) {
    console.error('[MONITOR] Error in monitor loop:', error);
  }
}

function calculateUptime(monitor, currentStatus) {
  // Simple uptime calculation logic for MVP
  // In a real app, this would be more complex based on logs
  return monitor.uptime || 100; 
}

async function handleAlert(monitor, newStatus, error = null) {
  const { name, url, userId, notifications } = monitor;
  console.log(`[ALERT] Monitor ${name} is ${newStatus.toUpperCase()}!`);

  // 1. Email Alert via Resend
  if (notifications?.email) {
    try {
      await resend.emails.send({
        from: 'PingPulse Alerts <alerts@masitaprex.com>',
        to: notifications.email,
        subject: `🚨 PingPulse: ${name} is ${newStatus.toUpperCase()}`,
        html: `
          <h1>Monitor Alert</h1>
          <p>Your monitor <strong>${name}</strong> (${url}) is now <strong>${newStatus.toUpperCase()}</strong>.</p>
          ${error ? `<p>Error: ${error}</p>` : ''}
          <p>Time: ${moment().tz('America/Lima').format('YYYY-MM-DD HH:mm:ss')} (PET)</p>
        `
      });
    } catch (e) {
      console.error('[ALERT] Error sending email:', e);
    }
  }

  // 2. Telegram Alert (Placeholder for future implementation)
  if (notifications?.telegram) {
    console.log(`[ALERT] Telegram notification would be sent to ${notifications.telegram}`);
  }
}

// Start the worker
(async () => {
  try {
    await initFirebase();
    console.log('[MONITOR] PingPulse Worker started');
    
    // Run immediately then on interval
    runMonitor();
    setInterval(runMonitor, CHECK_INTERVAL);
  } catch (error) {
    console.error('[MONITOR] Failed to start worker:', error);
    process.exit(1);
  }
})();
