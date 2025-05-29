import express from 'express';
import mp from './mercadoPago.js'; // instancia de MercadoPagoConfig
import { db } from './firebase.js'; 
import { Preference } from 'mercadopago/dist/clients/preference/index.js';
import { Payment } from 'mercadopago/dist/clients/payment/index.js';

const router = express.Router();



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
  console.log('🔔 Webhook recibido. Body:', req.body);

  try {
    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      console.error('❌ paymentId ausente en el webhook');
      res.sendStatus(400);
      return ;
    }

    // Inicializa cliente de Mercado Pago y busca el pago
    const paymentClient = new Payment(mp);
    const paymentResponse = await paymentClient.get({ id: paymentId });

    if (!paymentResponse) {
      console.error('❌ No se pudo obtener el pago desde la API de Mercado Pago');
       res.sendStatus(404);
       return;
    }

      const payment = (paymentResponse as any).body || paymentResponse;

    // Verifica metadata
    const metadata = payment?.metadata || {};
   const rawEmail: string = String(
  metadata.userEmail || metadata.user_email || metadata.email || ''
).trim();


    console.log('📦 Metadata:', metadata);
    console.log('📧 typeof rawEmail:', typeof rawEmail);
    console.log('📧 rawEmail === "":', rawEmail === '');
    console.log('📧 rawEmail.trim:', rawEmail?.trim?.());

    if (  
      !rawEmail 
    ) {
      console.error('❌ Metadata incompleta o email inválido:', metadata);
       res.sendStatus(200);
       return; // No intentamos reenviar desde Mercado Pago
    }

    const email = rawEmail.trim();
    const plan = metadata.plan ?? 'desconocido';

    // Guardamos en Firestore
     console.log('🔧 Intentando guardar en Firestore...');
    console.log('📝 Datos a guardar:', { email, plan, paid: true });
    
    const docRef = db.collection('usuarios').doc(email);
    await docRef.set({
      email,
      plan,
      paid: true,
      timestamp: new Date(),
    });
    await db.collection('ventas').add({
  email,
  plan,
  monto: payment.transaction_amount || 0,
  metodoPago: payment.payment_method_id || 'desconocido',
  estado: payment.status || 'desconocido',
  timestamp: new Date(),
});

console.log('✅ Usuario y venta guardados');
    res.sendStatus(200);
    
  } catch (error:any) {
    console.error('❌ Error detallado:', {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack
    });
    
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});
// 🔐 Verificar estado de suscripción del usuario
router.get('/user-plan-status', async (req, res) => {
  const userEmail = req.query.email as string;

  if (!userEmail || userEmail.trim() === '') {
     res.status(400).json({ error: 'Falta el email del usuario' });
     return
  }

  try {
    const docRef = db.collection('usuarios').doc(userEmail.trim());
    const doc = await docRef.get();

    if (!doc.exists) {
       res.status(200).json({ active: false, plan: null });
       return
    }

    const data = doc.data();

     res.status(200).json({
      active: !!data?.paid,
      plan: data?.plan || null,
    });
    return
  } catch (error: any) {
    console.error('❌ Error al verificar el plan del usuario:', error);
    res.status(500).json({ error: 'Error interno al verificar plan' });
  }
});
router.get('/ventas', async (req, res) => {
  try {
    const ventasSnapshot = await db.collection('ventas').orderBy('timestamp', 'desc').get();

    const ventas = ventasSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        plan: data.plan,
        monto: data.monto,
        fecha: data.timestamp ? data.timestamp.toDate().toISOString() : null,
        userEmail: data.email || null,
        // otros campos que quieras enviar al front
      };
    });

    res.status(200).json(ventas);
  } catch (error) {
    console.error('❌ Error al obtener ventas:', error);
    res.status(500).json({ error: 'Error interno al obtener ventas' });
  }
});

export default router;
