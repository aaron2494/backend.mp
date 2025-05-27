import express from 'express';
import mp from './mercadoPago.js'; // tu instancia de MercadoPagoConfig
import admin from 'firebase-admin';
import { cert, ServiceAccount } from 'firebase-admin/app';
import serviceAccount from '../firebase-service-account.json' with { type: 'json' };
import { getFirestore } from 'firebase-admin/firestore';
import { Preference } from 'mercadopago/dist/clients/preference/index.js';
const router = express.Router();

admin.initializeApp({
  credential: cert(serviceAccount as ServiceAccount),
});

const db = getFirestore();
router.post('/create-preference', async (req, res) => {
  const { plan, userEmail } = req.body;

  const price = plan === 'basico' ? 1 : plan === 'profesional' ? 2 : 3;

  const preference = new Preference(mp); // 👈 se instancia directamente el recurso Preference

  try {
    const result = await preference.create({
      body: {
        items: [
          {
            id: `plan-${plan}`,
            title: `Plan ${plan}`,
            quantity: 1,
            unit_price: price,
          },
        ],
        back_urls: {
          success: `${process.env.FRONTEND_URL}/plan-${plan}`,
          failure: `${process.env.FRONTEND_URL}`,
        },
        auto_return: 'approved',
        metadata: {
          userEmail,
          plan,
        },
      },
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    res.status(500).json({ error: 'No se pudo crear la preferencia' });
  }
});
import { Payment } from 'mercadopago/dist/clients/payment/index.js';

router.post('/webhook', express.json(), async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      res.sendStatus(400);
    }

     const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    const metadata = payment.metadata;

    if (!metadata || !metadata.userEmail) {
      console.error('Metadata no encontrada');
        res.sendStatus(400);
    }

    await db.collection('usuarios').doc(metadata.userEmail).set({
      email: metadata.userEmail,
      plan: metadata.plan,
      paid: true,
      timestamp: new Date(),
    });

    console.log('Usuario guardado en Firestore:', metadata.userEmail);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error en webhook', error);
    res.sendStatus(500);
  }
});

export default router;