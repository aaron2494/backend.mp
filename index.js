const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const nodemailer = require('nodemailer');
const serviceAccount = require('./firebase-service-account.json');
const admin = require('firebase-admin');

require('dotenv').config();

const { MercadoPagoConfig, Preference, Payment } = MercadoPago;

const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  sandbox:true
});

// Asegúrate de tener inicializado Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://innovatech-f77d8.firebaseio.com"
  });
}
const db = admin.firestore();

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
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions)); // CORS primero
app.use(express.json());
// Crear preferencia
app.post('/api/crear-preferencia', async (req, res) => {
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
  const { type, data } = req.body;
  console.log('📨 Webhook recibido. Tipo:', type, '| ID:', data?.id);

  // 1. Validación básica
  if (type !== 'payment') {
    console.log('⚠️ Evento ignorado (no es payment)');
    return res.status(200).json({ message: 'Evento no manejado' });
  }

  try {
    // 2. Obtener detalles del pago
    let paymentInfo;
    const isTestPayment = process.env.NODE_ENV !== 'production' && data.id === 'test-pago';

    if (isTestPayment) {
      console.log('🔧 Usando datos de prueba');
      paymentInfo = {
        status: 'approved',
        payer: { email: 'aaron.e.francolino@gmail.com' },
        metadata: { plan: 'Premium' },
        external_reference: 'user::aaron.e.francolino@gmail.com::Premium', // 👈 Simula tu front
        id: 'test-pago',
        transaction_amount: 1000,
        payment_method_id: 'visa'
      };
    } else {
      paymentInfo = (await mercadopago.payment.get({ id: data.id })).body;
      console.log('💳 Datos reales del pago:', JSON.stringify(paymentInfo, null, 2));
    }

    // 3. Validar estado del pago
    if (paymentInfo.status !== 'approved') {
      console.log('❌ Pago no aprobado. Estado:', paymentInfo.status);
      return res.status(200).json({ message: 'Pago no aprobado' });
    }

    // 4. Extraer datos clave
    const externalRefParts = paymentInfo.external_reference?.split('::') || [];
    const email = paymentInfo.payer?.email || paymentInfo.metadata?.email || externalRefParts[1];
    const plan = paymentInfo.metadata?.plan || externalRefParts[2];

    if (!email || !plan) {
      console.error('❌ Datos faltantes:', { email, plan, external_reference: paymentInfo.external_reference });
      throw new Error('Email o plan no encontrados en metadata/external_reference');
    }

    // 5. Guardar en Firestore
    const emailNormalizado = email.trim().toLowerCase();
    const userData = {
      planAdquirido: plan.toLowerCase(),
      ultimoPago: {
        id: paymentInfo.id,
        monto: paymentInfo.transaction_amount,
        metodo: paymentInfo.payment_method_id,
        fecha: new Date().toISOString()
      },
      fechaActualizacion: new Date().toISOString(),
      mpMetadata: paymentInfo.metadata
    };

    console.log('💾 Guardando en Firestore:', emailNormalizado, userData);
    await db.collection('usuarios').doc(emailNormalizado).set(userData, { merge: true });

    // 6. Enviar email (opcional)
    enviarEmailAlCliente({ 
      to: emailNormalizado, 
      plan: plan,
      monto: paymentInfo.transaction_amount
    }).catch(error => console.error('✉️ Error enviando email:', error));

    res.status(200).json({ 
  success: true, 
  email: emailNormalizado, 
  plan,
  firestorePath: `usuarios/${emailNormalizado}`
});

  } catch (error) {
    console.error('🔥 Error en webhook:', error);
    res.status(500).json({ 
      error: 'Error procesando webhook',
      detalle: process.env.NODE_ENV !== 'production' ? error.message : null
    });
  }
});

// Función de email mejorada
async function enviarEmailAlCliente({ to, plan, monto }) {
  const planes = {
    'basico': { descripcion: '...', precio: 1 },
    'profesional': { descripcion: '...', precio: 2 },
    'premium': { descripcion: '...', precio: 3 }
  };

  const planKey = plan.toLowerCase();
  const info = planes[planKey] || { 
    descripcion: 'Plan personalizado',
    precio: monto || 0
  };

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: `innovatech<${process.env.EMAIL_USER}>`,
    to,
    subject: `✅ Confirmación de compra: Plan ${plan}`,
    html: `
      <div style="font-family: Poppins, sans-serif; color: #333; padding: 20px;">
        <h2 style="color: #2c3e50;">¡Gracias por tu compra en innovatech!</h2>
        <p>Has adquirido el <strong>Plan ${plan}</strong> por <strong>$${info.precio} ARS</strong>.</p>
        <p>${info.descripcion}</p>
        <p><small>ID de transacción: ${paymentInfo.id}</small></p>
      </div>
    `
  });
}

app.get('/api/usuario/:email/plan', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const userDoc = await db.collection('usuarios').doc(email).get();

    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'Usuario no encontrado',
        suggestion: 'El webhook aún no ha procesado este pago'
      });
    }

    const data = userDoc.data();
    res.status(200).json({
      planAdquirido: data?.planAdquirido || null,
      ultimoPago: data?.ultimoPago || null,
      active: data?.planAdquirido && data?.fechaActualizacion
    });
  } catch (error) {
    console.error('Error al obtener el plan:', error);
    res.status(500).json({ 
      error: 'Error interno',
      detalle: process.env.NODE_ENV !== 'production' ? error.message : null
    });
  }
});

  app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
module.exports = app;