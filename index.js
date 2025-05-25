const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');

const serviceAccount = require('./firebase-service-account.json');
const admin = require('firebase-admin');

require('dotenv').config();

const { MercadoPagoConfig, Preference, Payment } = MercadoPago;

const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  sandbox:true
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
// Asegúrate de tener inicializado Firebase Admin
// 1. Verificar si Firebase Admin ya está inicializado
if (admin.apps.length === 0) {
  try {
    // 2. Configuración segura con variables de entorno
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID,
        clientEmail: serviceAccount.client_email || process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (serviceAccount.private_key || process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n')
      }),
      databaseURL: "https://innovatech-f77d8.firebaseio.com",
      storageBucket: "innovatech-f77d8.appspot.com" // Añadido para mayor compatibilidad
    });
    
    console.log('✅ Firebase Admin inicializado correctamente');
  } catch (error) {
    console.error('🔥 Error al inicializar Firebase Admin:', error);
    process.exit(1); // Salir si no se puede inicializar Firebase
  }
}

// 3. Obtener instancia de Firestore con configuración óptima
const db = admin.firestore();

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


 app.post('/api/webhook', async (req, res) => {
  const { type, data } = req.body;
  console.log('📨 Webhook recibido. Tipo:', type, '| ID:', data?.id);

  try {
    // Validación básica
    if (type !== 'payment') {
      return res.status(200).json({ message: 'Evento no manejado' });
    }

    // Obtener detalles del pago
    const paymentInfo = await obtenerDetallesPago(data.id);
    
    // Validar y procesar pago
    const resultado = await procesarPagoFirestore(paymentInfo);
    
    res.status(200).json(resultado);
  } catch (error) {
    console.error('🔥 Error en webhook:', error);
    res.status(500).json({ 
      error: 'Error procesando webhook',
      detalle: process.env.NODE_ENV !== 'production' ? error.message : null
    });
  }
});

// Funciones auxiliares
async function obtenerDetallesPago(paymentId) {
  if (paymentId === 'test-pago') {  // 👈 quitamos la condición de NODE_ENV
    return {
      status: 'approved',
      payer: { email: 'aaron.e.francolino@gmail.com' },
      metadata: { plan: 'básico' },
      external_reference: 'user::aaron.e.francolino@gmail.com::básico',
      id: 'test-pago',
      transaction_amount: 1000,
      payment_method_id: 'account_money'
    };
  }

  return (await payment.get({ id: paymentId })).body;
}

async function procesarPagoFirestore(paymentInfo) {
  if (paymentInfo.status !== 'approved') {
    throw new Error('Pago no aprobado');
  }

  const { email, plan } = extraerDatosPago(paymentInfo);
  await guardarEnFirestore(db, email, plan, paymentInfo);
  
  return { success: true, email, plan };
}

function extraerDatosPago(paymentInfo) {
  const externalRef = decodeURIComponent(paymentInfo.external_reference || '');
  const [,, plan] = externalRef.split('::');
  const email = (paymentInfo.payer?.email || '').toLowerCase().trim();

  if (!email || !plan) {
    throw new Error('Datos incompletos en el pago');
  }

  return { email, plan };
}

async function guardarEnFirestore(db, email, plan, paymentInfo) {
  const userRef = db.collection('usuarios').doc(email);
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

  await userRef.set(userData, { merge: true });
  console.log(`✅ Firestore actualizado para ${email}`);
}
app.post('/api/activar-plan', async (req, res) => {
  const { email, plan, pago } = req.body;
  if (!email || !plan) return res.status(400).json({ error: 'Datos incompletos' });

  try {
    // Aquí llamás a tu función para guardar en Firestore
    await guardarEnFirestore(db, email.toLowerCase(), plan.toLowerCase(), pago);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/usuario/:email/plan', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const userDoc = await db.collection('usuarios').doc(email).get();

    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'Usuario no encontrado',
        suggestion: 'El pago aún no ha sido procesado o el email es incorrecto'
      });
    }

    const data = userDoc.data();
    res.status(200).json({
      planAdquirido: data.planAdquirido,
      ultimoPago: data.ultimoPago || null,
      fechaActualizacion: data.fechaActualizacion,
      active: !!data.planAdquirido
    });
  } catch (error) {
    console.error('Error al obtener el plan:', error);
    res.status(500).json({ 
      error: 'Error interno',
      detalle: process.env.NODE_ENV !== 'production' ? error.message : null
    });
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

  app.listen(3000, () => {
  console.log('Servidor backend escuchando en http://localhost:3000');
});
module.exports = app;