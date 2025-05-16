const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const nodemailer = require('nodemailer');
require('dotenv').config(); // Para manejar variables de entorno

// SDK v2
const { MercadoPagoConfig, Preference, Payment } = MercadoPago;

const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-8894316476633004-051407-6244e92db1c8beb7e8212b575fe08641-179271995'
});

const preference = new Preference(mercadopago);
const payment = new Payment(mercadopago);

// Configuración del transporter de email (usa variables de entorno)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'aaron.e.francolino@gmail.com',
    pass: process.env.EMAIL_PASS || 'swyo ubtx wkxv qtmp'
  }
});

// Verificar conexión con el servicio de email al iniciar
transporter.verify((error) => {
  if (error) {
    console.error('❌ Error al conectar con el servicio de email:', error);
  } else {
    console.log('✅ Servidor de email listo para enviar mensajes');
  }
});

// Configuración CORS específica
const corsOptions = {
  origin: [
    'https://innovatexx.netlify.app',
    'http://localhost:4200' // Para desarrollo local
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Middlewares
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Habilitar preflight para todas las rutas
app.use(express.json());


// Crear preferencia
app.post('/api/crear-preferencia', async (req, res) => {
  try {
    const { plan, origen, email } = req.body; // Añadimos email en el body

    if (!plan || !origen || !email) {
      return res.status(400).send('Faltan datos requeridos');
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
        external_reference: `webpage-client::${origen}::${email}`, // Incluimos email en la referencia
        back_urls: {
          success: 'https://innovatexx.netlify.app/pago-exitoso',
          failure: 'https://innovatexx.netlify.app/pago-fallido',
          pending: 'https://innovatexx.netlify.app/pago-pendiente'
        },
        auto_return: 'approved',
        notification_url: 'https://tu-backend.com/api/mercado-pago-webhook' // URL para webhook
      },
    });

    res.json({ preferenceId: result.id });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    res.status(500).send('Error al crear preferencia');
  }
});

// Webhook para procesar pagos aprobados
app.post('/api/mercado-pago-webhook', async (req, res) => {
  try {
    const paymentId = req.query.id || req.body.data.id;
    
    if (!paymentId) {
      return res.status(400).send('ID de pago no proporcionado');
    }

    const paymentInfo = await payment.get({ id: paymentId });
    
    if (paymentInfo.status === 'approved') {
      // Extraer email de la referencia externa
      const [,, email] = paymentInfo.external_reference?.split('::') || [];
      const producto = paymentInfo.additional_info?.items?.[0]?.title || 'Producto no especificado';
      
      if (email) {
        await enviarEmailConfirmacion(email, producto, paymentInfo.id);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error en webhook:', err);
    res.sendStatus(500);
  }
});

// Función mejorada para enviar emails
async function enviarEmailConfirmacion(destinatario, producto, paymentId) {
  try {
    const mailOptions = {
      from: `InnovateXX <${process.env.EMAIL_USER || 'aaron.e.francolino@gmail.com'}>`,
      to: destinatario,
      subject: 'Confirmación de compra exitosa',
      html: `
        <h2>¡Gracias por tu compra en InnovateXX!</h2>
        <p>Hemos recibido tu pago por el producto: <strong>${producto}</strong>.</p>
        <p>ID de transacción: ${paymentId}</p>
        <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
        <br>
        <p>Equipo de InnovateXX</p>
      `,
      // Opcional: adjuntar factura o comprobante
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email enviado a ${destinatario}`, info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Error al enviar email:', error);
    return false;
  }
}

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

  app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
