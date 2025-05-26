const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');
const admin = require('firebase-admin');

require('dotenv').config();

const serviceAccount = require('./firebase-service-account.json'); // Tu clave
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Configuración de Mercado Pago para producción
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});


const app = express();

const corsOptions = {
  origin: 'https://innovatexx.netlify.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
// Middlewares (usa cors UNA sola vez)
app.use(cors(corsOptions));

// 2) Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/api/create-preference', async (req, res) => {
  try {
    const { plan, origen } = req.body;
    const email = origen;

    // Validación de campos requeridos
    if (!plan?.nombre || !plan?.precio || !origen) {
      return res.status(400).json({ 
        error: 'Faltan datos requeridos',
        detalles: {
          requiere: {
            plan: { nombre: 'string', precio: 'number' },
            origen: 'string'
          }
        }
      });
    }

    const result = await preference.create({
      body: {
       items: [{
      title: plan.nombre,
      unit_price: Number(plan.precio),
      quantity: 1, // 👈 Este campo debe estar y debe ser > 0
    }],
        external_reference: `user::${email}::${plan.nombre.toLowerCase()}`,
        metadata: { email, plan: plan.nombre }, // 👈 Añade metadata
        back_urls: { success: 'https://innovatexx.netlify.app/pago-exitoso' },
        auto_return: 'approved'
      }
    });

    res.json({ preferenceId: result.id });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al crear preferencia' });
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







































