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
      success: 'https://innovatexx.netlify.app/pago-exitoso',
    },
    auto_return: 'approved'
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
  const data = req.body;

  try {
    // Verificás si es una notificación de pago aprobado
    if (data.type === 'payment') {
      const paymentId = data.data.id;

      const paymentDetails = await payment.get({ id: paymentId });

      const info = paymentDetails.body;

      // Asegurarte que está aprobado
      if (info.status === 'approved') {
        const email = info.payer?.email;
        const planComprado = info.additional_info?.items?.[0]?.title || 'Desconocido';

        await enviarEmailAlCliente({
          to: email,
          plan: planComprado
        });
        console.log(`✉️ Email enviado a ${email}`);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Error en webhook:', err);
    res.status(500).send('Error procesando webhook');
  }
});
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'aaron.e.francolino@gmail.com',
    pass: 'levt tpwt zqsv hkoc'
  }
});

async function enviarEmailAlCliente({ to, plan }) {
  const planes = {
    'Básico': {
      descripcion: 'Ideal para pequeñas y medianas empresas que buscan optimizar sus procesos de manera eficiente. Incluye herramientas esenciales para el manejo de tu negocio, con soporte técnico básico. Perfecto para quienes están comenzando a dar sus primeros pasos en el mundo digital.',
      precio: 1
    },
    'Profesional': {
      descripcion: 'Solución avanzada para empresas que necesitan herramientas potentes para crecer y gestionar operaciones de mayor escala. Con acceso a funciones premium y soporte técnico prioritario, este plan está diseñado para optimizar la productividad y ofrecer soluciones personalizadas.',
      precio: 2
    },
    'Premium': {
      descripcion: 'Automatización total para empresas grandes y proyectos ambiciosos. Incluye las funcionalidades del plan Profesional y herramientas avanzadas de análisis, seguridad y gestión. Acceso a soporte personalizado 24/7, optimización de procesos a medida y características avanzadas para maximizar la eficiencia.',
      precio: 3
    }
  };

  const info = planes[plan] || {
    descripcion: 'Gracias por adquirir uno de nuestros servicios.',
    precio: 0
  };

  const htmlContent = `
    <div style="font-family: 'Segoe UI', sans-serif; color: #333; padding: 20px; line-height: 1.6;">
      <h2 style="color: #2c3e50;">🎉 ¡Gracias por tu compra!</h2>
      <p>Hola,</p>
      <p>Te agradecemos por confiar en <strong>Innovatexx</strong>. Has adquirido el plan <strong>${plan}</strong>, una excelente elección para potenciar tu negocio.</p>
      <div style="border-left: 4px solid #3498db; padding-left: 15px; margin: 20px 0;">
        <h3 style="margin-bottom: 5px;">📦 Plan ${plan}</h3>
        <p style="margin: 0;"><em>${info.descripcion}</em></p>
        <p style="margin-top: 10px;"><strong>Precio abonado:</strong> $${info.precio} ARS</p>
      </div>
      <p>En breve nos pondremos en contacto contigo para comenzar con el proceso de implementación.</p>
      <p style="margin-top: 30px;">Saludos cordiales,<br><strong>El equipo de Innovatexx</strong></p>
      <hr style="margin-top: 40px; border: none; border-top: 1px solid #ccc;" />
      <p style="font-size: 12px; color: #777;">Este mensaje fue enviado automáticamente. Si tienes alguna duda, no dudes en escribirnos a contacto@innovatexx.com</p>
    </div>
  `;

  await transporter.sendMail({
    from: 'Innovatech <aaron.e.francolino@gmail.com>',
    to,
    subject: `🧾 Confirmación de compra: Plan ${plan}`,
    html: htmlContent
  });
}

  app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
module.exports = app;