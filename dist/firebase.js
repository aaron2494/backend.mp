import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from '../config/firebase-service-account.json' with { type: 'json' };
const firebaseConfig = {
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key.replace(/\\n/g, '\n')
};
let db;
try {
    const app = initializeApp({
        credential: cert(firebaseConfig),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
    });
    db = getFirestore(app);
    console.log('✅ Firebase inicializado correctamente');
}
catch (error) {
    console.error('❌ Error al inicializar Firebase:', error);
    throw error;
}
export { db };
