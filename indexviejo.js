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

// Funciones auxiliares mejoradas
async function obtenerDetallesPago(paymentId) {
  // 1. Primero verificar si es un pago de prueba
  if (paymentId === 'test-pago') {
    console.log('🔧 Usando datos de prueba');
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

  // 2. Obtener datos reales de Mercado Pago
  try {
    const response = await payment.get({ id: paymentId });
    if (!response || !response.body) {
      throw new Error('Respuesta vacía de la API de Mercado Pago');
    }
    return response.body;
  } catch (error) {
    console.error('Error al obtener pago de Mercado Pago:', {
      paymentId,
      error: error.response?.data || error.message
    });
    throw error;
  }
}

async function procesarPagoFirestore(paymentInfo) {
  // Validación robusta del objeto paymentInfo
  if (!paymentInfo || typeof paymentInfo !== 'object') {
    throw new Error('Datos de pago inválidos');
  }

  if (paymentInfo.status !== 'approved') {
    console.log('❌ Pago no aprobado. Estado:', paymentInfo.status);
    throw new Error('Pago no aprobado');
  }

  const { email, plan } = extraerDatosPago(paymentInfo);
  await guardarEnFirestore(db, email, plan, paymentInfo);
  
  return { 
    success: true, 
    email, 
    plan,
    paymentId: paymentInfo.id 
  };
}

function extraerDatosPago(paymentInfo) {
  try {
    const externalRef = decodeURIComponent(paymentInfo.external_reference || '');
    const [,, plan] = externalRef.split('::');
    const email = (paymentInfo.payer?.email || '').toLowerCase().trim();

    if (!email || !plan) {
      console.error('❌ Datos faltantes en el pago:', {
        external_reference: paymentInfo.external_reference,
        payer: paymentInfo.payer
      });
      throw new Error('Datos incompletos en el pago (email o plan faltante)');
    }

    return { email, plan };
  } catch (error) {
    console.error('Error al extraer datos del pago:', {
      paymentInfo,
      error: error.message
    });
    throw new Error('Formato de datos de pago inválido');
  }
}

async function guardarEnFirestore(db, email, plan, paymentInfo) {
  try {
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
      mpMetadata: paymentInfo.metadata || {}
    };

    await userRef.set(userData, { merge: true });
    console.log(`✅ Firestore actualizado para ${email}`, { 
      plan: plan.toLowerCase(),
      paymentId: paymentInfo.id 
    });
  } catch (error) {
    console.error('Error al guardar en Firestore:', {
      email,
      plan,
      error: error.message
    });
    throw new Error('Error al actualizar la base de datos');
  }
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