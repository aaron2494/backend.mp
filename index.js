const express = require('express');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const admin = require('firebase-admin');
require('dotenv').config();
const serviceAccount = require('./firebase-service-account.json');
const { MercadoPagoConfig, Preference, Payment } = MercadoPago;

// Configuración de Mercado Pago para producción
const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const preference = new Preference(mercadopago);
const payment = new Payment(mercadopago);
const app = express();

// Configuración CORS para producción
const corsOptions = {
  origin: 'https://innovatexx.netlify.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Inicialización de Firebase Admin
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
app.use(cors(corsOptions));
app.use(express.json());

// Endpoint para crear preferencia de pago
app.post('/api/crear-preferencia', async (req, res) => {
  try {
    const { plan, origen } = req.body;
    const email = origen;

    if (!plan?.nombre || !plan?.precio || !origen) {
      return res.status(400).json({ 
        error: 'Faltan datos requeridos: plan (nombre, precio) y origen'
      });
    }

    const result = await preference.create({
      body: {
        items: [{
          title: plan.nombre,
          unit_price: Number(plan.precio),
          quantity: 1,
        }],
        external_reference: `user::${email}::${plan.nombre.toLowerCase()}`,
        metadata: { email, plan: plan.nombre },
        back_urls: { success: 'https://innovatexx.netlify.app/pago-exitoso' },
        auto_return: 'approved'
      }
    });

    res.json({ preferenceId: result.id });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

// Webhook para procesar pagos
app.post('/api/webhook', async (req, res) => {
  console.log('🔔 Webhook recibido - Headers:', req.headers);
  console.log('🔔 Webhook recibido - Body:', JSON.stringify(req.body, null, 2));
  
  const { type, data } = req.body;

  try {
    if (type !== 'payment' || !data?.id) {
      console.log('⚠️ Webhook ignorado - Tipo:', type, 'ID:', data?.id);
      return res.status(200).json({ message: 'Evento no manejado' });
    }

    const paymentInfo = await obtenerDetallesPago(data.id);
    console.log('💰 Pago obtenido:', {
      id: paymentInfo.id,
      status: paymentInfo.status,
      amount: paymentInfo.transaction_amount,
      method: paymentInfo.payment_method_id
    });

    const resultado = await procesarPagoFirestore(paymentInfo);
    res.status(200).json(resultado);
  } catch (error) {
    console.error('🔥 Error en webhook:', {
      message: error.message,
      paymentId: data?.id,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ error: 'Error procesando pago' });
  }
});

// Funciones auxiliares
async function obtenerDetallesPago(paymentId) {
  try {
    const response = await payment.get({ id: paymentId });
    
    if (!response || !response.body) {
      console.log('🔄 Reintentando obtener pago...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const retryResponse = await payment.get({ id: paymentId });
      if (!retryResponse || !retryResponse.body) {
        throw new Error('No se pudo obtener información del pago después de reintento');
      }
      return retryResponse.body;
    }
    return response.body;
  } catch (error) {
    console.error('Error al obtener pago:', {
      paymentId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

async function procesarPagoFirestore(paymentInfo) {
  if (!paymentInfo || paymentInfo.status !== 'approved') {
    throw new Error(`Estado de pago inválido: ${paymentInfo?.status}`);
  }

  const { email, plan } = extraerDatosPago(paymentInfo);
  
  const userData = {
    planAdquirido: plan.toLowerCase(),
    ultimoPago: {
      id: paymentInfo.id,
      monto: paymentInfo.transaction_amount,
      metodo: paymentInfo.payment_method_id,
      fecha: new Date().toISOString()
    },
    fechaActualizacion: new Date().toISOString()
  };

  await db.collection('usuarios').doc(email).set(userData, { merge: true });
  console.log(`✅ Usuario actualizado: ${email} - Plan: ${plan}`);
  
  return { success: true, email, plan, paymentId: paymentInfo.id };
}

function extraerDatosPago(paymentInfo) {
  const externalRef = paymentInfo.external_reference || '';
  const [,, plan] = externalRef.split('::');
  const email = (paymentInfo.payer?.email || '').toLowerCase().trim();

  if (!email || !plan) {
    console.error('❌ Datos faltantes en pago:', {
      external_reference: externalRef,
      payer: paymentInfo.payer
    });
    throw new Error('Datos incompletos en el pago');
  }

  return { email, plan };
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
// Endpoint para verificar plan de usuario
app.get('/api/usuario/:email/plan', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const userDoc = await db.collection('usuarios').doc(email).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.status(200).json(userDoc.data());
  } catch (error) {
    console.error('Error al obtener plan:', error);
    res.status(500).json({ error: 'Error interno' });
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
// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en producción escuchando en puerto ${PORT}`);
});

module.exports = app;




