import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
admin.initializeApp({
    credential: admin.credential.cert('../firebase-service-account.json')
});
export const db = getFirestore();
