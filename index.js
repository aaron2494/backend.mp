const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');
const admin = require('firebase-admin');
const app = express();

app.use(cors());
app.use(express.json());

// Firebase Admin Init
const serviceAccount = require('./serviceAccountKey.json'); // Tu clave
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Mercado Pago Init
mercadopago.configure({
  access_token: 'APP_USR-8105204432976930-052515-307bb9efc331156241647febd01dce1e-1488503587',
});

// Crear preferencia
app.post('/create-preference', async (req, res) => {
  const { plan, userEmail } = req.body;

  const preference = {
    items: [{ title: plan, quantity: 1, unit_price: plan === 'basico' ? 10 : plan === 'profesional' ? 20 : 30 }],
    back_urls: {
      success: `http://innovatexx.netlify.app/plan-${plan}`,
      failure: `http://innovatexx.netlify.app`,
    },
    auto_return: 'approved',
    metadata: { userEmail, plan },
  };

  try {
    const response = await mercadopago.preferences.create(preference);
    res.json({ init_point: response.body.init_point });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear preferencia');
  }
});

// Webhook de confirmación de pago
app.post('api/webhook', async (req, res) => {
  const data = req.body;

  // Aquí deberías consultar al API de MP para verificar pago real
  const payment = await mercadopago.payment.findById(data.data.id);
  const metadata = payment.body.metadata;

  await db.collection('usuarios').doc(metadata.userEmail).set({
    plan: metadata.plan,
    paid: true,
  });

  res.sendStatus(200);
});

app.listen(3000, () => console.log('Servidor backend en puerto 3000'));
