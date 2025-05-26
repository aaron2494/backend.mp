const express = require('express');
const cors = require('cors');
const app = express();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const serviceAccount = require('./firebase-service-account.json');
const admin = require('firebase-admin');

require('dotenv').config();


const mercadopago = new MercadoPagoConfig({
  accessToken: 'APP_USR-8105204432976930-052515-307bb9efc331156241647febd01dce1e-1488503587',
});

const allowedOrigins = [
  'https://verdant-brigadeiros-32ef4b.netlify.app',
  'http://localhost:4200',
   'https://backend-mp-g3mr.vercel.app'
];
// 3. Obtener instancia de Firestore con configuración óptima
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200 // Para legacy browsers
};

// Middlewares
app.use(cors(corsOptions));
app.options('/api/create-preference', cors(corsOptions));
app.use(express.json());
const db = admin.firestore();

// Crear preferencia
app.post('/api/create-preference', async (req, res) => {
const { plan, userEmail } = req.body;
  
  // Aquí tu lógica con MercadoPago...
  const preference = {
    items: [
      {
        title: `Plan ${plan}`,
        unit_price: getPlanPrice(plan),
        quantity: 1,
      }
    ],
    payer: {
      email: userEmail
    },
    back_urls: {
      success: 'https://verdant-brigadeiros-32ef4b.netlify.app',
    },
    auto_return: 'approved'
  };

  // Devuelve la respuesta que espera el frontend
  res.json({
    init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123' // Ejemplo
  });
});

function getPlanPrice(plan) {
  const prices = { basico: 1, profesional: 2, premium: 3 };
  return prices[plan] || 1;
}


app.post('/api/webhook', async (req, res) => {
  const { type, data } = req.body;
  console.log('📨 Webhook recibido. Tipo:', type, '| ID:', data?.id);

  try {
    // 1. Validación básica
    if (type !== 'payment') {
      console.log('⚠️ Evento ignorado (no es payment)');
      return res.status(200).json({ message: 'Evento no manejado' });
    }

    if (!data?.id) {
      throw new Error('ID de pago no proporcionado en el webhook');
    }

    // 2. Obtener detalles del pago con manejo de errores mejorado
    let paymentInfo;
    try {
      paymentInfo = await obtenerDetallesPago(data.id);
      console.log('💳 Datos del pago obtenidos:', { 
        id: paymentInfo.id, 
        status: paymentInfo.status 
      });
    } catch (error) {
      console.error('Error al obtener detalles del pago:', error);
      throw new Error('No se pudieron obtener los detalles del pago desde Mercado Pago');
    }

    // 3. Validar y procesar pago
    const resultado = await procesarPagoFirestore(paymentInfo);
    
    res.status(200).json(resultado);
  } catch (error) {
    console.error('🔥 Error en webhook:', {
      message: error.message,
      stack: error.stack,
      requestBody: req.body
    });
    res.status(500).json({ 
      error: 'Error procesando webhook',
      detalle: process.env.NODE_ENV !== 'production' ? error.message : null
    });
  }
});

module.exports = app;