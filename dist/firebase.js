import dotenv from 'dotenv';
dotenv.config();
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// Validar variables
const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error('❌ Faltan variables de entorno necesarias para Firebase.');
}
const firebaseConfig = {
    projectId: FIREBASE_PROJECT_ID,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: FIREBASE_CLIENT_EMAIL,
};
const app = initializeApp({
    credential: cert(firebaseConfig)
});
const db = getFirestore(app);
export { db };
