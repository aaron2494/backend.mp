const express = require('express');
const MercadoPago = require('mercadopago');
const cors = require('cors');
// Crear instancia de MercadoPago con el access token
const mercadopago = new MercadoPago.MercadoPagoConfig({
  accessToken: 'APP_USR-8894316476633004-051407-6244e92db1c8beb7e8212b575fe08641-179271995',
});

const preference = new MercadoPago.Preference(mercadopago);

const app = express();
app.use(express.json());
// ✅ Habilitar CORS para aceptar solicitudes del frontend
app.use(cors());
app.post('/api/crear-preferencia', async (req, res) => {
  try {
    const { plan } = req.body;
 if (!plan) {
      return res.status(400).send('Plan no proporcionado');
    }
     console.log(plan);

    const result = await preference.create({
      body: {
        items: [
          {
            title: plan.nombre, // Se espera que 'plan' tenga el atributo 'nombre'
            quantity: 1,
            currency_id: 'ARS',
            unit_price: plan.precio // Se espera que 'plan' tenga el atributo 'precio'
          }
        ]
      }
    });
    
    res.json({ preferenceId: result.id });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    res.status(500).send('Error al crear preferencia');
  }
});
app.get('/api/ventas', async (req, res) => {
  try {
    const searchResult = await mercadopago.payment.search({
      qs: {
        sort: 'date_created',
        criteria: 'desc'
      }
    });

    const ventas = searchResult.body.results.map((pago) => ({
      id: pago.id,
      fecha: pago.date_created,
      plan: pago.description || pago.additional_info?.items?.[0]?.title || 'Desconocido',
      estado: pago.status,
      monto: pago.transaction_amount,
      metodo: pago.payment_method_id
    }));

    res.json(ventas);
  } catch (error) {
    console.error('Error al obtener ventas:', error);
    res.status(500).send('Error al obtener ventas');
  }
});

app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
