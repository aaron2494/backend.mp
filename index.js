const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const admin = require('firebase-admin');

require('dotenv').config();
const { MercadoPagoConfig } = MercadoPago;

const serviceAccount = require('./firebase-service-account.json'); // Tu clave
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Configuración de Mercado Pago para producción
const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});


const app = express();

const corsOptions = {
  origin: 'https://innovatexx.netlify.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions));
app.use(cors());
app.use(express.json());
// Crear preferencia
app.post('/api/create-preference', async (req, res) => {
  const { plan, userEmail } = req.body;

  const amount = plan === 'basico' ? 1 :
                 plan === 'profesional' ? 2 : 3;

  const preferenceData = {
    items: [
      {
        title: `Plan ${plan}`,
        quantity: 1,
        unit_price: amount,
        currency_id: 'ARS'
      }
    ],
    back_urls: {
      success: `https://innovatexx.netlify.app/plan-${plan}`,
      failure: `https://innovatexx.netlify.app`,
      pending: `https://innovatexx.netlify.app`
    },
    auto_return: 'approved',
    metadata: {
      userEmail,
      plan
    }
  };

  try {
    const preference = await mercadopago.preferences.create({ body: preferenceData });
    res.json({ init_point: preference.init_point });
  } catch (err) {
    console.error('Error al crear preferencia:', err);
    res.status(500).send('Error al crear preferencia');
  }
});
// Webhook de confirmación de pago
app.post('/api/webhook', async (req, res) => {
  const data = req.body;

  try {
    const payment = await mercadopago.payment.findById(data.data.id);
    const metadata = payment.body.metadata;

    await db.collection('usuarios').doc(metadata.userEmail).set(
      {
        plan: metadata.plan,
        paid: true,
      },
      { merge: true }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en producción escuchando en puerto ${PORT}`);
});

module.exports = app;







































