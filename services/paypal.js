'use strict';

// Suscripcion mensual de OZAMA Premium via PayPal Subscriptions API.
// Mismo patron que services/google-auth.js y services/recaptcha.js:
// nunca expone secretos al cliente, todo lo sensible vive server-side.
//
// PAYPAL_ENV = 'live' | 'sandbox' (default 'sandbox' hasta que se
// confirme explicitamente 'live' -- asi nunca se cobra de verdad por
// accidente mientras se prueba).

function paypalBaseUrl() {
  return String(process.env.PAYPAL_ENV || '').trim() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function paypalConfigured() {
  return Boolean(String(process.env.PAYPAL_CLIENT_ID || '').trim())
    && Boolean(String(process.env.PAYPAL_CLIENT_SECRET || '').trim());
}

function billingProviderConfig() {
  return {
    enabled: paypalConfigured() && Boolean(String(process.env.PAYPAL_PLAN_ID || '').trim()),
    clientId: String(process.env.PAYPAL_CLIENT_ID || '').trim(),
    planId: String(process.env.PAYPAL_PLAN_ID || '').trim(),
  };
}

let cachedToken = null; // { value, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('PayPal no esta configurado.');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`PayPal auth fallo (${response.status}).`);
  const data = await response.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
  return cachedToken.value;
}

async function paypalRequest(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${paypalBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || `PayPal request fallo (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

// Trae los datos de una suscripcion directo de PayPal -- nunca hay
// que confiar en lo que manda el cliente (subscriptionID) para
// decidir "es premium", siempre se reconsulta contra PayPal.
async function fetchSubscription(subscriptionId) {
  const clean = String(subscriptionId || '').trim();
  if (!clean || clean.length > 60) return null;
  try {
    return await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(clean)}`);
  } catch (_) {
    return null;
  }
}

// Setup de una sola vez: crea el producto + plan mensual de OZAMA
// Premium en la cuenta de PayPal configurada. Se corre a mano
// (scripts/setup-paypal-plan.js), no en cada arranque del servidor --
// el Plan ID resultante se guarda en PAYPAL_PLAN_ID y de ahi en mas
// el checkout solo lo referencia.
async function createPremiumProductAndPlan({ price = '4.99', currency = 'USD' } = {}) {
  const product = await paypalRequest('/v1/catalogs/products', {
    method: 'POST',
    body: {
      name: 'OZAMA Premium',
      description: 'Cosmeticos, historial extendido y contenido exclusivo en OZAMA CHESS. Nunca da ventaja competitiva en partida.',
      type: 'SERVICE',
      category: 'SOFTWARE',
    },
  });

  const plan = await paypalRequest('/v1/billing/plans', {
    method: 'POST',
    body: {
      product_id: product.id,
      name: 'OZAMA Premium Mensual',
      description: 'Suscripcion mensual a OZAMA Premium.',
      billing_cycles: [{
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // indefinido, se renueva hasta que se cancele
        pricing_scheme: { fixed_price: { value: price, currency_code: currency } },
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 2,
      },
    },
  });

  return { product, plan };
}

// Pide la cancelacion real ante PayPal (no solo en nuestra DB) --
// asi PayPal deja de cobrarle al usuario de verdad.
async function cancelSubscription(subscriptionId, reason) {
  const clean = String(subscriptionId || '').trim();
  if (!clean || clean.length > 60) throw new Error('ID de suscripcion invalido.');
  await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(clean)}/cancel`, {
    method: 'POST',
    body: { reason: String(reason || 'Cancelado por el usuario.').slice(0, 200) },
  });
}

// Verifica la firma de un webhook de PayPal contra el WEBHOOK_ID
// configurado -- sin esto, cualquiera podria mandar un POST falso a
// /api/billing/webhook diciendo "esta suscripcion esta activa" y
// convertirse en premium gratis.
async function verifyWebhookSignature(headers, body) {
  const webhookId = String(process.env.PAYPAL_WEBHOOK_ID || '').trim();
  if (!webhookId) return false;

  const result = await paypalRequest('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: body,
    },
  });
  return result?.verification_status === 'SUCCESS';
}

module.exports = {
  paypalConfigured,
  billingProviderConfig,
  fetchSubscription,
  createPremiumProductAndPlan,
  cancelSubscription,
  verifyWebhookSignature,
};
