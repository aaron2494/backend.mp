import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtener __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta donde Render coloca los secret files
const serviceAccountPath = process.env.NODE_ENV === 'production'
  ? '/etc/secrets/firebase-service-account.json'
  : path.join(__dirname, '../config/firebase-service-account.json');

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

const app = initializeApp({
  credential: cert(serviceAccount as ServiceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});

export const db = getFirestore(app);
