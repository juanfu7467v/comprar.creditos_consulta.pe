import { admin } from "../config/firebase.js";
import logger from "../utils/logger.js";

const PUBLIC_ROUTES = [
  "/login",
  "/planes",
  "/verificacion",
  "/politica",
  "/terminos",
  "/error-404",
  "/sitemap.xml",
  "/robots.txt",
  "/disclaimer-apis",
  "/API-Docs",
  "/PeliPREX",
  "/aviso-legal-peliprex"
];

const PUBLIC_API_ROUTES = [
  "/api/webhook",
  "/api/login",
  "/api/health",
  "/api/debug",
  "/api/invoice-options",
  "/api/report-failed-login"
];

export async function verifyFirebaseAuth(req, res, next) {
  const context = 'AUTH_MIDDLEWARE';

  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    req.path === route || req.path.startsWith(route)
  );

  const isPublicApiRoute = PUBLIC_API_ROUTES.some(route =>
    req.path.startsWith(route)
  );

  const isStaticFile = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|map)$/i.test(req.path);

  if (isPublicRoute || isPublicApiRoute || isStaticFile) {
    logger.info(context, 'Ruta pública o excluida', { path: req.path });
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    const cookies = req.headers.cookie;
    let idToken;
    let sessionCookie;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      idToken = authHeader.split('Bearer ')[1];
    } else if (cookies) {
      const cookiesArray = cookies.split(';');
      const sessionCookieValue = cookiesArray.find(cookie => cookie.trim().startsWith('__session='));
      if (sessionCookieValue) {
        sessionCookie = sessionCookieValue.split('=')[1].trim();
        const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
        req.user = decodedClaims;
        req.uid = decodedClaims.uid;
        return next();
      }
      
      const idTokenCookie = cookiesArray.find(cookie => cookie.trim().startsWith('__idToken='));
      if (idTokenCookie) {
        idToken = idTokenCookie.split('=')[1].trim();
      }
    }

    if (!idToken && !sessionCookie) {
      const returnTo = encodeURIComponent(req.originalUrl);
      return res.redirect(`/login?returnTo=${returnTo}`);
    }

    if (idToken) {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
      req.uid = decodedToken.uid;
      return next();
    }
  } catch (error) {
    logger.error(context, 'Error en autenticación', error, { path: req.path });
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${returnTo}`);
  }
}
