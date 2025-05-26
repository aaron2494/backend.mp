const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');
const admin = require('firebase-admin');
const app = express();


app.use(cors({
  origin: '*' // o '*' para todos
}));
app.use(express.json());

// Firebase Admin Init
const serviceAccount = require('./firebase-service-account.json'); // Tu clave
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();


const mp = new mercadopago.MercadoPagoConfig({
  accessToken: 'APP_USR-8105204432976930-052515-307bb9efc331156241647febd01dce1e-1488503587'
});
// Crear preferencia
app.post('/create-preference', async (req, res) => {
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
      success: `http://innovatexx.netlify.app/plan-${plan}`,
      failure: `http://innovatexx.netlify.app`,
      pending: `http://innovatexx.netlify.app`
    },
    auto_return: 'approved',
    metadata: {
      userEmail,
      plan
    }
  };

  try {
    const preference = await new Preference(mp).create({ body: preferenceData });
    res.json({ init_point: preference.init_point });
  } catch (err) {
    console.error('Error al crear preferencia:', err);
    res.status(500).send('Error al crear preferencia');
  }
});
// Webhook de confirmación de pago
app.post('/webhook', async (req, res) => {
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

app.listen(3000, () => console.log('Servidor backend en puerto 3000'));
