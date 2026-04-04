import { getDb } from '../shared/firebase.js';

/**
 * Generate SVG badge for uptime
 */
export async function generateUptimeBadge(monitorId) {
  try {
    const db = getDb();
    const doc = await db.collection('pp_monitors').doc(monitorId).get();

    if (!doc.exists) {
      return generateErrorBadge('Monitor not found');
    }

    const monitor = doc.data();
    const uptime = monitor.uptime || 100;
    const status = monitor.status || 'unknown';

    // Determine color based on uptime
    let color = '#10b981'; // green for 99%+
    if (uptime < 95) color = '#ef4444'; // red for <95%
    else if (uptime < 99) color = '#f59e0b'; // yellow for 95-99%

    // Create SVG badge
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="20" role="img" aria-label="Uptime: ${uptime}%">
        <title>Uptime: ${uptime}%</title>
        <linearGradient id="s" x2="0" y2="100%">
          <stop offset="0" stop-color="#bbb"/>
          <stop offset="1" stop-color="#999"/>
        </linearGradient>
        <clipPath id="r">
          <rect width="200" height="20" rx="3" fill="#fff"/>
        </clipPath>
        <g clip-path="url(#r)">
          <rect width="70" height="20" fill="#555"/>
          <rect x="70" width="130" height="20" fill="${color}"/>
          <rect width="200" height="20" fill="url(#s)"/>
        </g>
        <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
          <text aria-hidden="true" x="350" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="600">uptime</text>
          <text x="350" y="140" transform="scale(.1)" fill="#fff" textLength="600">uptime</text>
          <text aria-hidden="true" x="1340" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="1200">${uptime}%</text>
          <text x="1340" y="140" transform="scale(.1)" fill="#fff" textLength="1200">${uptime}%</text>
        </g>
      </svg>
    `;

    return {
      svg,
      contentType: 'image/svg+xml',
      cacheControl: 'public, max-age=300' // 5 minutes cache
    };
  } catch (error) {
    console.error('[BADGE] Error generating badge:', error);
    return generateErrorBadge('Error');
  }
}

/**
 * Generate status badge
 */
export async function generateStatusBadge(monitorId) {
  try {
    const db = getDb();
    const doc = await db.collection('pp_monitors').doc(monitorId).get();

    if (!doc.exists) {
      return generateErrorBadge('Monitor not found');
    }

    const monitor = doc.data();
    const status = monitor.status || 'unknown';
    const statusText = status === 'up' ? 'UP' : status === 'down' ? 'DOWN' : 'UNKNOWN';
    const color = status === 'up' ? '#10b981' : status === 'down' ? '#ef4444' : '#9ca3af';

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="150" height="20" role="img" aria-label="Status: ${statusText}">
        <title>Status: ${statusText}</title>
        <linearGradient id="s" x2="0" y2="100%">
          <stop offset="0" stop-color="#bbb"/>
          <stop offset="1" stop-color="#999"/>
        </linearGradient>
        <clipPath id="r">
          <rect width="150" height="20" rx="3" fill="#fff"/>
        </clipPath>
        <g clip-path="url(#r)">
          <rect width="60" height="20" fill="#555"/>
          <rect x="60" width="90" height="20" fill="${color}"/>
          <rect width="150" height="20" fill="url(#s)"/>
        </g>
        <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
          <text aria-hidden="true" x="310" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="500">status</text>
          <text x="310" y="140" transform="scale(.1)" fill="#fff" textLength="500">status</text>
          <text aria-hidden="true" x="1040" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="800">${statusText}</text>
          <text x="1040" y="140" transform="scale(.1)" fill="#fff" textLength="800">${statusText}</text>
        </g>
      </svg>
    `;

    return {
      svg,
      contentType: 'image/svg+xml',
      cacheControl: 'public, max-age=60' // 1 minute cache for status
    };
  } catch (error) {
    console.error('[BADGE] Error generating status badge:', error);
    return generateErrorBadge('Error');
  }
}

/**
 * Generate response time badge
 */
export async function generateResponseTimeBadge(monitorId) {
  try {
    const db = getDb();
    const doc = await db.collection('pp_monitors').doc(monitorId).get();

    if (!doc.exists) {
      return generateErrorBadge('Monitor not found');
    }

    const monitor = doc.data();
    const responseTime = monitor.lastResponseTime || 0;

    // Determine color based on response time
    let color = '#10b981'; // green for <100ms
    if (responseTime > 500) color = '#ef4444'; // red for >500ms
    else if (responseTime > 200) color = '#f59e0b'; // yellow for 200-500ms

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="180" height="20" role="img" aria-label="Response: ${responseTime}ms">
        <title>Response: ${responseTime}ms</title>
        <linearGradient id="s" x2="0" y2="100%">
          <stop offset="0" stop-color="#bbb"/>
          <stop offset="1" stop-color="#999"/>
        </linearGradient>
        <clipPath id="r">
          <rect width="180" height="20" rx="3" fill="#fff"/>
        </clipPath>
        <g clip-path="url(#r)">
          <rect width="80" height="20" fill="#555"/>
          <rect x="80" width="100" height="20" fill="${color}"/>
          <rect width="180" height="20" fill="url(#s)"/>
        </g>
        <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
          <text aria-hidden="true" x="410" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="700">response</text>
          <text x="410" y="140" transform="scale(.1)" fill="#fff" textLength="700">response</text>
          <text aria-hidden="true" x="1290" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="900">${responseTime}ms</text>
          <text x="1290" y="140" transform="scale(.1)" fill="#fff" textLength="900">${responseTime}ms</text>
        </g>
      </svg>
    `;

    return {
      svg,
      contentType: 'image/svg+xml',
      cacheControl: 'public, max-age=300' // 5 minutes cache
    };
  } catch (error) {
    console.error('[BADGE] Error generating response time badge:', error);
    return generateErrorBadge('Error');
  }
}

/**
 * Generate error badge
 */
function generateErrorBadge(message) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="150" height="20" role="img" aria-label="${message}">
      <title>${message}</title>
      <linearGradient id="s" x2="0" y2="100%">
        <stop offset="0" stop-color="#bbb"/>
        <stop offset="1" stop-color="#999"/>
      </linearGradient>
      <clipPath id="r">
        <rect width="150" height="20" rx="3" fill="#fff"/>
      </clipPath>
      <g clip-path="url(#r)">
        <rect width="150" height="20" fill="#9ca3af"/>
        <rect width="150" height="20" fill="url(#s)"/>
      </g>
      <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
        <text aria-hidden="true" x="750" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="1400">${message}</text>
        <text x="750" y="140" transform="scale(.1)" fill="#fff" textLength="1400">${message}</text>
      </g>
    </svg>
  `;

  return {
    svg,
    contentType: 'image/svg+xml',
    cacheControl: 'public, max-age=60'
  };
}
