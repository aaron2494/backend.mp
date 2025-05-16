const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const nodemailer = require('nodemailer');
// SDK v2
const { MercadoPagoConfig, Preference, Payment } = MercadoPago;

const mercadopago = new MercadoPagoConfig({
  accessToken: 'APP_USR-8894316476633004-051407-6244e92db1c8beb7e8212b575fe08641-179271995'
});

const preference = new Preference(mercadopago);
const payment = new Payment(mercadopago);
// Configuración del transporter de email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'aaron.e.francolino@gmail.com',
    pass: 'levt tpwt zqsv hkoc'
  }
});
const app = express();
// 1. Configuración CORS debe ir PRIMERO
const corsOptions = {
  origin: [
    'https://innovatexx.netlify.app',
    'http://localhost:4200'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions)); // CORS primero

app.use(express.json());
// 3. Verificar conexión SMTP al iniciar
transporter.verify((error) => {
  if (error) {
    console.error('❌ Error SMTP:', error);
  } else {
    console.log('✅ SMTP configurado correctamente');
  }
});

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
        external_reference: `webpage-client::${origen}`
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

// 4. Webhook mejorado
app.post('/api/webhook', async (req, res) => {
  try {
    // Respuesta inmediata para MP
    res.sendStatus(200);
    
    // Procesamiento asíncrono
    const paymentId = req.body?.data?.id;
    if (!paymentId || req.body.type !== 'payment') return;

    const pago = await payment.get({ id: paymentId });
    
    if (pago.status === 'approved') {
      const email = pago.payer?.email;
      const plan = pago.additional_info?.items?.[0]?.title || 'Sin plan';
      
      if (email) {
        await enviarEmailAlCliente(email, plan, pago.id);
      }
    }
  } catch (error) {
    console.error('❌ Error en webhook:', error);
  }
});

// 5. Función de email con mejor manejo de errores
async function enviarEmailAlCliente(email, plan, idPago) {
  try {
    const mailOptions = {
      from: 'InnovateXX <aaron.e.francolino@gmail.com>',
      to: email,
      subject: 'Confirmación de compra',
      html: `
        <h2>¡Gracias por tu compra en InnovateXX!</h2>
        <p>Detalles de tu transacción:</p>
        <ul>
          <li><strong>Plan:</strong> ${plan}</li>
          <li><strong>ID de transacción:</strong> ${idPago}</li>
        </ul>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email enviado a ${email} (ID: ${info.messageId})`);
  } catch (error) {
    console.error(`❌ Fallo al enviar email a ${email}:`, error);
  }
}

  app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
