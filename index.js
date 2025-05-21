const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const nodemailer = require('nodemailer');
const serviceAccount = require('./firebase-service-account.json');
const admin = require('firebase-admin');

require('dotenv').config();

const { MercadoPagoConfig, Preference, Payment } = MercadoPago;

const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
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
        external_reference: `webpage-client::${origen}::${plan.nombre.toLowerCase()}`,
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
app.post('/api/guardar-compra', (req, res) => {
  const { userId, email, plan } = req.body;

  console.log('📝 Guardando compra:', { userId, email, plan });

  // Acá podrías guardar en una base de datos si querés
  res.status(200).json({ mensaje: 'Compra guardada exitosamente' });
});
// POST /api/registrar-plan
app.post('/api/registrar-plan', async (req, res) => {
  const { email, plan } = req.body;

  if (!email || !plan) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    // Guardar en tu base de datos
    // Ejemplo usando MongoDB:
    await db.collection('usuarios').updateOne(
      { email },
      { $set: { planAdquirido: plan } },
      { upsert: true }
    );

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el plan' });
  }
});
app.post('/api/webhook', async (req, res) => {
   const data = req.body;

  console.log('📨 Webhook recibido:', JSON.stringify(data, null, 2));

  try {
    if (data.type === 'payment') {
      const paymentId = data.data.id;
      console.log('💳 Buscando detalles del pago ID:', paymentId);

      const paymentDetails = await payment.get({ id: paymentId });
      const info = paymentDetails.body;

      console.log('ℹ️ Detalles del pago:', info);

      if (info.status === 'approved') {
        const email = info.payer?.email;
        const planComprado = info.additional_info?.items?.[0]?.title || 'Desconocido';
        console.log('✅ Pago aprobado. Enviando mail a:', email, 'Plan:', planComprado);

        await enviarEmailAlCliente({
          to: email,
          plan: planComprado
        });
        console.log(`✉️ Email enviado a ${email}`);
      } else {
        console.log('⚠️ El pago no está aprobado. Estado:', info.status);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Error en webhook:', err.message || err);
    res.status(500).send('Error procesando webhook');
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
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
     user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
  await transporter.sendMail({
    from: 'Innovatech <aaron.e.francolino@gmail.com>',
    to,
    subject: `🧾 Confirmación de compra: Plan ${plan}`,
    html: htmlContent
  });
}
app.post('/api/registrar-plan', async (req, res) => {
  const { email, plan } = req.body;

  // Validación más robusta
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  const planesPermitidos = ['basico', 'premium', 'empresa'];
  if (!planesPermitidos.includes(plan)) {
    return res.status(400).json({ error: 'Plan no válido' });
  }

  try {
    const docRef = db.collection('usuarios').doc(email);
    await docRef.set({ 
      email,
      planAdquirido: plan,
      fechaActualizacion: new Date().toISOString(), // Campo adicional útil
      historicoPlanes: admin.firestore.FieldValue.arrayUnion(plan) // Guarda histórico
    }, { merge: true });

    console.log(`Plan actualizado para ${email}: ${plan}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error al guardar el plan:', error);
    res.status(500).json({ 
      error: 'Error al guardar el plan',
      detalle: error.message // Solo en desarrollo, no en producción
    });
  }
});
// Asegúrate de tener inicializado Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://innovatech-f77d8.firebaseio.com"
  });
}
const db = admin.firestore();

// Ruta para consultar el plan de un usuario por email
app.get('/api/usuario/:email/plan', async (req, res) => {
  const email = req.params.email;

  // Validación básica del email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  try {
    const doc = await db.collection('usuarios').doc(email).get();

    if (!doc.exists) {
      return res.status(404).json({ 
        exists: false,
        message: 'Usuario no registrado' 
      });
    }

    const userData = doc.data();
    res.status(200).json({
      exists: true,
      planAdquirido: userData?.planAdquirido || null,
      ultimaActualizacion: userData?.fechaActualizacion || null
    });

  } catch (error) {
    console.error('Error Firestore:', error);
    res.status(500).json({ 
      error: 'Error al consultar la base de datos',
      detalle: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});
  app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
module.exports = app;