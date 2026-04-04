import express from 'express';
import { initFirebase, getDb } from '../shared/firebase.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const router = express.Router();

// Initialize Firebase for PingPulse
initFirebase().catch(err => console.error('[PINGPULSE_API] Firebase init error:', err));

/**
 * Middleware to verify user authentication
 * Expects userId in req.user (set by main app's auth middleware)
 */
const authMiddleware = async (req, res, next) => {
  const userId = req.user?.uid || req.headers['x-user-id'];
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized - No user ID provided' });
  }
  
  req.userId = userId;
  next();
};

/**
 * Middleware to verify subscription and plan
 */
const checkSubscription = async (req, res, next) => {
  const db = getDb();
  const userId = req.userId;

  try {
    const subSnapshot = await db.collection('pp_subscriptions')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (subSnapshot.empty) {
      // Check for free trial
      const trialSnapshot = await db.collection('pp_subscriptions')
        .where('userId', '==', userId)
        .where('plan', '==', 'free_trial')
        .limit(1)
        .get();

      if (trialSnapshot.empty) {
        return res.status(403).json({ error: 'No active subscription found' });
      }

      req.subscription = trialSnapshot.docs[0].data();
    } else {
      req.subscription = subSnapshot.docs[0].data();
    }

    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Check monitor limit based on plan
 */
const getMonitorLimit = (plan) => {
  const limits = {
    'free_trial': 5,
    'starter': 5,
    'pro': 20,
    'business': 75,
    'agency': 200
  };
  return limits[plan] || 0;
};

/**
 * Get minimum frequency based on plan
 */
const getMinFrequency = (plan) => {
  const frequencies = {
    'free_trial': 5,
    'starter': 5,
    'pro': 1,
    'business': 0.5, // 30 seconds
    'agency': 0.5
  };
  return frequencies[plan] || 5;
};

// ===== MONITOR MANAGEMENT =====

/**
 * GET /api/pingpulse/monitors
 * Get all monitors for the authenticated user
 */
router.get('/monitors', authMiddleware, checkSubscription, async (req, res) => {
  const db = getDb();
  const userId = req.userId;

  try {
    const snapshot = await db.collection('pp_monitors')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const monitors = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt,
      lastCheck: doc.data().lastCheck?.toDate?.() || doc.data().lastCheck,
      lastDown: doc.data().lastDown?.toDate?.() || doc.data().lastDown
    }));

    res.json({
      success: true,
      data: monitors,
      count: monitors.length,
      limit: getMonitorLimit(req.subscription.plan)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/pingpulse/monitors
 * Create a new monitor
 */
router.post('/monitors', authMiddleware, checkSubscription, async (req, res) => {
  const db = getDb();
  const userId = req.userId;
  const { name, url, frequency, type, notifications } = req.body;

  // Validate input
  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  try {
    // Check monitor limit
    const existingSnapshot = await db.collection('pp_monitors')
      .where('userId', '==', userId)
      .get();

    const limit = getMonitorLimit(req.subscription.plan);
    if (existingSnapshot.size >= limit) {
      return res.status(403).json({
        error: `Monitor limit reached for your plan (${limit} monitors)`,
        limit
      });
    }

    // Check frequency limit
    const minFrequency = getMinFrequency(req.subscription.plan);
    const requestedFrequency = frequency || 5;
    if (requestedFrequency < minFrequency) {
      return res.status(400).json({
        error: `Minimum frequency for your plan is ${minFrequency} minutes`,
        minFrequency
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const newMonitor = {
      userId,
      name,
      url,
      frequency: requestedFrequency,
      type: type || 'http',
      status: 'unknown',
      uptime: 100,
      active: true,
      createdAt: new Date(),
      lastCheck: null,
      lastDown: null,
      lastResponseTime: 0,
      notifications: notifications || { email: true },
      sslDaysRemaining: null
    };

    const docRef = await db.collection('pp_monitors').add(newMonitor);

    res.status(201).json({
      success: true,
      data: {
        id: docRef.id,
        ...newMonitor
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/pingpulse/monitors/:id
 * Get details of a specific monitor
 */
router.get('/monitors/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.userId;

  try {
    const doc = await db.collection('pp_monitors').doc(monitorId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const monitor = doc.data();

    // Check ownership
    if (monitor.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({
      success: true,
      data: {
        id: doc.id,
        ...monitor,
        createdAt: monitor.createdAt?.toDate?.() || monitor.createdAt,
        lastCheck: monitor.lastCheck?.toDate?.() || monitor.lastCheck,
        lastDown: monitor.lastDown?.toDate?.() || monitor.lastDown
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/pingpulse/monitors/:id
 * Update a monitor
 */
router.put('/monitors/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.userId;
  const { name, url, frequency, type, notifications, active } = req.body;

  try {
    const doc = await db.collection('pp_monitors').doc(monitorId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const monitor = doc.data();

    // Check ownership
    if (monitor.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (url !== undefined) {
      // Validate URL
      try {
        new URL(url);
        updateData.url = url;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
    }
    if (frequency !== undefined) updateData.frequency = frequency;
    if (type !== undefined) updateData.type = type;
    if (notifications !== undefined) updateData.notifications = notifications;
    if (active !== undefined) updateData.active = active;

    await db.collection('pp_monitors').doc(monitorId).update(updateData);

    const updatedDoc = await db.collection('pp_monitors').doc(monitorId).get();

    res.json({
      success: true,
      data: {
        id: updatedDoc.id,
        ...updatedDoc.data(),
        createdAt: updatedDoc.data().createdAt?.toDate?.() || updatedDoc.data().createdAt,
        lastCheck: updatedDoc.data().lastCheck?.toDate?.() || updatedDoc.data().lastCheck,
        lastDown: updatedDoc.data().lastDown?.toDate?.() || updatedDoc.data().lastDown
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/pingpulse/monitors/:id
 * Delete a monitor
 */
router.delete('/monitors/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.userId;

  try {
    const doc = await db.collection('pp_monitors').doc(monitorId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const monitor = doc.data();

    // Check ownership
    if (monitor.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await db.collection('pp_monitors').doc(monitorId).delete();

    res.json({ success: true, message: 'Monitor deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== LOGS AND HISTORY =====

/**
 * GET /api/pingpulse/monitors/:id/logs
 * Get logs for a specific monitor
 */
router.get('/monitors/:id/logs', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.userId;
  const days = parseInt(req.query.days) || 7;

  try {
    // Verify ownership
    const monitorDoc = await db.collection('pp_monitors').doc(monitorId).get();
    if (!monitorDoc.exists || monitorDoc.data().userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .where('timestamp', '>=', daysAgo)
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();

    const logs = logsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp
    }));

    res.json({
      success: true,
      data: logs,
      count: logs.length,
      period: days
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== INCIDENTS =====

/**
 * GET /api/pingpulse/monitors/:id/incidents
 * Get incidents for a specific monitor
 */
router.get('/monitors/:id/incidents', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.userId;
  const days = parseInt(req.query.days) || 30;

  try {
    // Verify ownership
    const monitorDoc = await db.collection('pp_monitors').doc(monitorId).get();
    if (!monitorDoc.exists || monitorDoc.data().userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const incidentsSnapshot = await db.collection('pp_incidents')
      .where('monitorId', '==', monitorId)
      .where('startTime', '>=', daysAgo)
      .orderBy('startTime', 'desc')
      .get();

    const incidents = incidentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      startTime: doc.data().startTime?.toDate?.() || doc.data().startTime,
      endTime: doc.data().endTime?.toDate?.() || doc.data().endTime
    }));

    res.json({
      success: true,
      data: incidents,
      count: incidents.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== PUBLIC STATUS PAGE =====

/**
 * GET /api/pingpulse/status/:id
 * Get public status for a monitor (no auth required)
 */
router.get('/status/:id', async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;

  try {
    const doc = await db.collection('pp_monitors').doc(monitorId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const monitor = doc.data();

    // Get last 30 days of logs for uptime calculation
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .where('timestamp', '>=', thirtyDaysAgo)
      .orderBy('timestamp', 'desc')
      .get();

    const logs = logsSnapshot.docs.map(doc => ({
      timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
      status: doc.data().status,
      responseTime: doc.data().responseTime
    }));

    // Get recent incidents
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const incidentsSnapshot = await db.collection('pp_incidents')
      .where('monitorId', '==', monitorId)
      .where('startTime', '>=', sevenDaysAgo)
      .orderBy('startTime', 'desc')
      .limit(10)
      .get();

    const incidents = incidentsSnapshot.docs.map(doc => ({
      startTime: doc.data().startTime?.toDate?.() || doc.data().startTime,
      endTime: doc.data().endTime?.toDate?.() || doc.data().endTime,
      duration: doc.data().duration,
      errorMessage: doc.data().errorMessage
    }));

    res.json({
      success: true,
      data: {
        name: monitor.name,
        url: monitor.url,
        status: monitor.status,
        uptime: monitor.uptime || 100,
        lastCheck: monitor.lastCheck?.toDate?.() || monitor.lastCheck,
        lastDown: monitor.lastDown?.toDate?.() || monitor.lastDown,
        lastResponseTime: monitor.lastResponseTime,
        sslDaysRemaining: monitor.sslDaysRemaining,
        logs: logs.slice(0, 100),
        incidents: incidents,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== REPORTS =====

/**
 * GET /api/pingpulse/reports/daily/:id
 * Get daily report for a monitor
 */
router.get('/reports/daily/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.userId;

  try {
    // Verify ownership
    const monitorDoc = await db.collection('pp_monitors').doc(monitorId).get();
    if (!monitorDoc.exists || monitorDoc.data().userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .where('timestamp', '>=', today)
      .where('timestamp', '<', tomorrow)
      .get();

    const logs = logsSnapshot.docs.map(doc => doc.data());
    const upLogs = logs.filter(log => log.status === 'up').length;
    const downLogs = logs.filter(log => log.status === 'down').length;
    const totalLogs = logs.length;

    const dailyUptime = totalLogs > 0 ? Math.round((upLogs / totalLogs) * 100 * 100) / 100 : 100;

    res.json({
      success: true,
      data: {
        date: today.toISOString().split('T')[0],
        uptime: dailyUptime,
        upCount: upLogs,
        downCount: downLogs,
        totalChecks: totalLogs,
        averageResponseTime: logs.length > 0 ? Math.round(logs.reduce((sum, log) => sum + (log.responseTime || 0), 0) / logs.length) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/pingpulse/reports/weekly/:id
 * Get weekly report for a monitor
 */
router.get('/reports/weekly/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.userId;

  try {
    // Verify ownership
    const monitorDoc = await db.collection('pp_monitors').doc(monitorId).get();
    if (!monitorDoc.exists || monitorDoc.data().userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .where('timestamp', '>=', sevenDaysAgo)
      .get();

    const logs = logsSnapshot.docs.map(doc => doc.data());
    const upLogs = logs.filter(log => log.status === 'up').length;
    const downLogs = logs.filter(log => log.status === 'down').length;
    const totalLogs = logs.length;

    const weeklyUptime = totalLogs > 0 ? Math.round((upLogs / totalLogs) * 100 * 100) / 100 : 100;

    // Get incidents
    const incidentsSnapshot = await db.collection('pp_incidents')
      .where('monitorId', '==', monitorId)
      .where('startTime', '>=', sevenDaysAgo)
      .get();

    const incidents = incidentsSnapshot.docs.map(doc => doc.data());
    const totalDowntime = incidents.reduce((sum, incident) => sum + (incident.duration || 0), 0);

    res.json({
      success: true,
      data: {
        startDate: sevenDaysAgo.toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        uptime: weeklyUptime,
        upCount: upLogs,
        downCount: downLogs,
        totalChecks: totalLogs,
        incidentCount: incidents.length,
        totalDowntime: Math.round(totalDowntime / 1000 / 60), // in minutes
        averageResponseTime: logs.length > 0 ? Math.round(logs.reduce((sum, log) => sum + (log.responseTime || 0), 0) / logs.length) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
