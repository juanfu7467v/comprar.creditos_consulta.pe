import admin from "firebase-admin";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;

function buildServiceAccountFromEnv() {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    }
    
    // Fallback to individual env vars if the full JSON is not provided
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    };
  } catch (error) {
    console.error('[FIREBASE_CONFIG] Error parsing service account:', error);
    return null;
  }
}

export const initFirebase = async () => {
  if (admin.apps.length) {
    db = admin.firestore();
    return db;
  }

  const serviceAccount = buildServiceAccountFromEnv();

  if (serviceAccount && serviceAccount.project_id) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
      db = admin.firestore();
      db.settings({ ignoreUndefinedProperties: true });
      console.log('[FIREBASE] PingPulse Firebase initialized');
      return db;
    } catch (error) {
      console.error('[FIREBASE] Error initializing Firebase:', error);
      throw error;
    }
  } else {
    console.error('[FIREBASE] No service account provided');
    throw new Error('Firebase service account missing');
  }
};

export const getDb = () => {
  if (!db) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return db;
};
