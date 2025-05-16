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

// Configuración CORS
const corsOptions = {
  origin: [
    'https://innovatexx.netlify.app',
    'http://localhost:4200'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());


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
        external_reference: `webpage-client::${origen}`,
        back_urls: {
        success:'https://innovatexx.netlify.app/pago-exitoso',
      },
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
    const result = await payment.search({
      options: {
        status: 'approved',
        sort: 'date_created',
        criteria: 'desc',
        limit: 50
      }
    });

    console.log("Últimos 5 pagos (referencias):", 
      (result.results?.slice(0, 5) || []).map(p => ({
        id: p.id,
        ref: p.external_reference,
        tipo: p.payment_type_id
      }))
    );

    const ventasFiltradas = (result.results || []).filter(p => {
      
      const tieneReferencia = p.external_reference?.includes('webpage-client');
      const esTipoValido = ['credit_card', 'debit_card', 'account_money'].includes(p.payment_type_id);

      if (!tieneReferencia && esTipoValido) {
        
        console.warn(`Pago sin referencia válida (ID: ${p.id})`, {
          referencia: p.external_reference,
          tipo: p.payment_type_id
        });
      }

      return tieneReferencia && esTipoValido;
    });

    const ventasFormateadas = ventasFiltradas.map(p => ({
      id: p.id,
  fecha: p.date_created,  // enviar sin formatear, frontend formatea
  monto: p.transaction_amount,
  metodo: p.payment_method_id, // o mapeado a nombre legible
  plan: p.additional_info?.items?.[0]?.title || p.description || 'Venta no identificada',
  referencia: p.external_reference,
  estado: p.status || 'desconocido',
  cliente: p.payer?.email,
    }));

    console.log(`✅ Pagos filtrados: ${ventasFormateadas.length}`);
    res.json(ventasFormateadas);

  } catch (error) {
    console.error("❌ Error al obtener ventas:", {
      message: error.message,
      code: error.code,
      data: error.response?.data
    });
    res.status(500).json({ error: "Error al obtener ventas" });
  }
});

app.post('/api/webhook', async (req, res) => {
  const paymentId = req.body?.data?.id;

  try {
    if (req.body.type === 'payment') {
      const pago = await payment.get({ id: paymentId });

      if (pago.status === 'approved') {
        const email = pago.payer?.email;
        const plan = pago.additional_info?.items?.[0]?.title || 'Sin plan';

        // Acá enviás el email
        await enviarEmailAlCliente(email, plan, pago.id);

        console.log(`📧 Email enviado a ${email}`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.sendStatus(500);
  }
});
const nodemailer = require('nodemailer');

async function enviarEmailAlCliente(email, plan, idPago) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'aaron.e.francolino@gmail.com',
      pass: 'levt tpwt zqsv hkoc'
    }
  });

  const mailOptions = {
    from: 'aaron.e.francolino@gmail.com',
    to: email,
    subject: 'Gracias por tu compra',
    html: `
      <h2>¡Gracias por tu compra!</h2>
      <p>Tu pago fue aprobado correctamente.</p>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>ID de pago:</strong> ${idPago}</p>
    `
  };

  await transporter.sendMail(mailOptions);
}



  module.exports = app;

