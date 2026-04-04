import express from 'express';
import { getDb } from '../shared/firebase.js';

const router = express.Router();

/**
 * Generate SVG badge for uptime display
 * Usage: <img src="/api/pingpulse/badge/:monitorId" alt="Uptime Badge">
 */
router.get('/badge/:monitorId', async (req, res) => {
  const { monitorId } = req.params;
  const db = getDb();

  try {
    const doc = await db.collection('pp_monitors').doc(monitorId).get();
    
    if (!doc.exists) {
      return res.status(404).send('Monitor not found');
    }

    const monitor = doc.data();
    const uptime = monitor.uptime || 100;
    const status = monitor.status || 'unknown';

    // Determine color based on uptime
    let color = '#10b981'; // green
    if (uptime < 99) color = '#f59e0b'; // amber
    if (uptime < 95) color = '#ef4444'; // red

    // SVG Badge (Shield style)
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="20" role="img" aria-label="Uptime: ${uptime}%">
        <title>Uptime: ${uptime}%</title>
        <linearGradient id="s" x2="0" y2="100%">
          <stop offset="0" stop-color="#bbb"/>
          <stop offset="1" stop-color="#999"/>
        </linearGradient>
        <clipPath id="r">
          <rect width="120" height="20" rx="3" fill="#fff"/>
        </clipPath>
        <g clip-path="url(#r)">
          <rect width="60" height="20" fill="#555"/>
          <rect x="60" width="60" height="20" fill="${color}"/>
          <rect width="120" height="20" fill="url(#s)"/>
        </g>
        <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
          <text aria-hidden="true" x="300" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="500">Uptime</text>
          <text x="300" y="140" transform="scale(.1)" fill="#fff" textLength="500">Uptime</text>
          <text aria-hidden="true" x="890" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="500">${uptime}%</text>
          <text x="890" y="140" transform="scale(.1)" fill="#fff" textLength="500">${uptime}%</text>
        </g>
      </svg>
    `;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(svg);
  } catch (error) {
    console.error('[BADGE] Error generating badge:', error);
    res.status(500).send('Error generating badge');
  }
});

export default router;
