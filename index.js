const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');

// SDK v2
const { MercadoPagoConfig, Preference, Payment } = MercadoPago;

const mercadopago = new MercadoPagoConfig({
  accessToken: 'APP_USR-8894316476633004-051407-6244e92db1c8beb7e8212b575fe08641-179271995'
});

const preference = new Preference(mercadopago);
const payment = new Payment(mercadopago);

const app = express();
app.use(express.json());
app.use(cors());

// Crear preferencia
app.post('/api/crear-preferencia', async (req, res) => {
  try {
    const { plan, origen } = req.body;

    if (!plan || !origen) {
      return res.status(400).send('Faltan datos');
    }

    const result = await preference.create({
      body: {
        items: [
          {
            title: plan.nombre,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: plan.precio
          }
        ],
        external_reference: 'webpage-client::' + origen
      }
    });

    res.json({ preferenceId: result.id });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    res.status(500).send('Error al crear preferencia');
  }
});

// Obtener ventas
app.get('/api/ventas', async (req, res) => {
  try {
    const result = await payment.search({
      query: {
        external_reference: 'webpage-client::',
        status: 'approved'
      }
    });

    const ventasDesdeWeb = result.results.filter(p => {
      return (
        p.external_reference &&
        p.external_reference.startsWith('webpage-client::') &&
        p.status === 'approved'
      );
    });

    const ventasFormateadas = ventasDesdeWeb.map(p => ({
      id: p.id,
      fecha: p.date_created,
      plan: p.description || 'Sin descripción',
      monto: p.transaction_amount,
      metodo: p.payment_method_id,
      estado: p.status,
      cliente: p.external_reference.replace('webpage-client::', '')
    }));

    res.json(ventasFormateadas);
  } catch (error) {
    console.error('Error al obtener ventas:', error);
    res.status(500).send('Error al obtener ventas');
  }
});

app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
