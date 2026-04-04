import express from 'express';
import { initFirebase, getDb } from '../shared/firebase.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const router = express.Router();

// Initialize Firebase for PingPulse
initFirebase().catch(err => console.error('[PINGPULSE_API] Firebase init error:', err));

// Middleware to check authentication (reusing existing logic if possible)
// Since we can't modify existing code, we'll implement a simple check for now
// or expect the main app to pass the user context.
const authMiddleware = async (req, res, next) => {
  // In a real integration, we'd use the main app's auth session/cookie
  // For now, we'll assume the user is authenticated if they have a valid session
  // or we'll check the 'usuarios' collection in Firebase.
  const sessionCookie = req.cookies?.session || req.headers.authorization;
  
  if (!sessionCookie) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // This is a placeholder for actual session verification
    // const decodedToken = await admin.auth().verifySessionCookie(sessionCookie);
    // req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid session' });
  }
};

// --- Monitor Management ---

// Get all monitors for a user
router.get('/monitors', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.uid;
  
  try {
    const snapshot = await db.collection('pp_monitors').where('userId', '==', userId).get();
    const monitors = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(monitors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new monitor
router.post('/monitors', authMiddleware, async (req, res) => {
  const db = getDb();
  const { name, url, frequency, type, notifications } = req.body;
  const userId = req.user.uid;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  try {
    const newMonitor = {
      userId,
      name,
      url,
      frequency: frequency || 5, // default 5 mins
      type: type || 'http',
      status: 'unknown',
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      notifications: notifications || { email: req.user.email }
    };

    const docRef = await db.collection('pp_monitors').add(newMonitor);
    res.status(201).json({ id: docRef.id, ...newMonitor });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a monitor
router.delete('/monitors/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;
  const userId = req.user.uid;

  try {
    const doc = await db.collection('pp_monitors').doc(monitorId).get();
    if (!doc.exists || doc.data().userId !== userId) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    await db.collection('pp_monitors').doc(monitorId).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Public Status Page ---

// Get public status for a monitor
router.get('/status/:id', async (req, res) => {
  const db = getDb();
  const monitorId = req.params.id;

  try {
    const doc = await db.collection('pp_monitors').doc(monitorId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const monitor = doc.data();
    
    // Get last 30 days of logs for uptime chart
    const logsSnapshot = await db.collection('pp_logs')
      .where('monitorId', '==', monitorId)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    const logs = logsSnapshot.docs.map(doc => doc.data());

    res.json({
      name: monitor.name,
      status: monitor.status,
      uptime: monitor.uptime || 100,
      lastCheck: monitor.lastCheck,
      history: logs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
