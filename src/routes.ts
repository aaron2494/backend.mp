import express from 'express';
import mp from './mercadoPago.js'; // instancia de MercadoPagoConfig
import admin from 'firebase-admin';
import { cert, ServiceAccount } from 'firebase-admin/app';
import serviceAccount from '../firebase-service-account.json' with { type: 'json' };
import { getFirestore } from 'firebase-admin/firestore';
import { Preference } from 'mercadopago/dist/clients/preference/index.js';
import { Payment } from 'mercadopago/dist/clients/payment/index.js';

const router = express.Router();

// 🔐 Inicializa Firebase solo si no está ya inicializado
if (!admin.apps.length) {
  admin.initializeApp({
    credential: cert(serviceAccount as ServiceAccount),
  });
}
const db = getFirestore();

// 🎯 Crear preferencia de pago
router.post('/create-preference', async (req, res) => {
  const { plan, userEmail } = req.body;

  if (!plan || !userEmail) {
     res.status(400).json({ error: 'Faltan datos requeridos (plan o email)' });
  }

  const priceMap: Record<string, number> = {
    basico: 1,
    profesional: 2,
    premium: 3,
  };

  const price = priceMap[plan];
  if (!price) {
     res.status(400).json({ error: 'Plan no válido' });
  }

  const preference = new Preference(mp);

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
    console.error('❌ Error al crear preferencia:', error);
    res.status(500).json({ error: 'No se pudo crear la preferencia' });
  }
});

// 📩 Webhook de confirmación de pago
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      console.error('❌ paymentId ausente en el webhook');
       res.sendStatus(400);
    }

    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    if (!payment) {
      console.error('❌ No se pudo obtener el pago desde la API de MP');
       res.sendStatus(404);
    }

    const metadata = payment?.metadata;

    if (
      !metadata ||
      !metadata.userEmail ||
      typeof metadata.userEmail !== 'string' ||
      metadata.userEmail.trim() === ''
    ) {
      console.error('❌ Metadata incompleta o email inválido:', metadata);
       res.sendStatus(200); // Respondé 200 para evitar retries infinitos
    }

    const email = metadata.userEmail.trim();
    const plan = metadata.plan ?? 'desconocido';

    await db.collection('usuarios').doc(email).set({
      email,
      plan,
      paid: true,
      timestamp: new Date(),
    });

    console.log('✅ Usuario guardado en Firestore:', email);
     res.sendStatus(200);

  } catch (error) {
    console.error('❌ Error en webhook:', error);
     res.sendStatus(500);
  }
});

export default router;
