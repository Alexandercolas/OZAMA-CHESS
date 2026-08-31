'use strict';

const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const {
  billingProviderConfig,
  fetchSubscription,
  cancelSubscription,
  verifyWebhookSignature,
} = require('../services/paypal');

const router = express.Router();

function serverError(res, scope, err) {
  console.error(`[Billing] ${scope}:`, err.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

// Config publica para renderizar el boton de PayPal (client id + plan
// id son publicos por diseno -- el secret nunca sale de aca).
router.get('/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(billingProviderConfig());
});

// El cliente manda el subscriptionID que le dio el boton de PayPal
// despues de que el usuario aprobo el pago -- esto SOLO marca la
// cuenta como premium si, al reconsultar directo contra PayPal, la
// suscripcion esta realmente ACTIVE y corresponde al plan de OZAMA.
// Nunca hay que confiar en el estado que manda el cliente.
router.post('/confirm', requireAuth, async (req, res) => {
  try {
    const subscriptionId = String(req.body?.subscriptionID || '').trim();
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Falta el ID de suscripcion.' });
    }

    const subscription = await fetchSubscription(subscriptionId);
    const expectedPlanId = String(process.env.PAYPAL_PLAN_ID || '').trim();
    if (!subscription || subscription.plan_id !== expectedPlanId) {
      return res.status(400).json({ error: 'No se pudo verificar la suscripcion.' });
    }
    if (subscription.status !== 'ACTIVE') {
      return res.status(400).json({ error: `La suscripcion todavia no esta activa (estado: ${subscription.status}).` });
    }

    // Una suscripcion de PayPal no puede quedar atada a dos cuentas de
    // OZAMA a la vez.
    const existingOwner = await User.findOne({ paypalSubscriptionId: subscriptionId }).select('_id');
    if (existingOwner && String(existingOwner._id) !== String(req.user._id)) {
      return res.status(409).json({ error: 'Esa suscripcion ya esta asociada a otra cuenta.' });
    }

    const nextBilling = subscription.billing_info?.next_billing_time
      ? new Date(subscription.billing_info.next_billing_time)
      : null;

    await User.updateOne({ _id: req.user._id }, { $set: {
      plan: 'premium',
      subscriptionStatus: 'active',
      paypalSubscriptionId: subscriptionId,
      premiumUntil: nextBilling,
    }});

    res.json({ ok: true, plan: 'premium', premiumUntil: nextBilling });
  } catch (err) {
    serverError(res, 'confirm', err);
  }
});

// El usuario pide cancelar desde OZAMA -- se lo pedimos a PayPal
// directamente (no solo marcamos la DB), asi PayPal deja de cobrar de
// verdad. El webhook de BILLING.SUBSCRIPTION.CANCELLED despues
// confirma y limpia el estado.
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+paypalSubscriptionId');
    const subscriptionId = user?.paypalSubscriptionId;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'No tienes una suscripcion activa.' });
    }

    await cancelSubscription(subscriptionId, req.body?.reason || 'Cancelado por el usuario desde OZAMA CHESS.');

    await User.updateOne({ _id: req.user._id }, { $set: { subscriptionStatus: 'cancelled' } });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'cancel', err);
  }
});

// Webhook de PayPal -- mantiene la cuenta sincronizada aunque el
// usuario nunca vuelva a abrir OZAMA (renovaciones, cancelaciones
// hechas desde PayPal directamente, pagos fallidos, etc.).
router.post('/webhook', async (req, res) => {
  try {
    const verified = await verifyWebhookSignature(req.headers, req.body);
    if (!verified) {
      console.warn('[Billing] Webhook con firma invalida, ignorado.');
      return res.status(400).json({ error: 'Firma invalida.' });
    }

    const event = req.body;
    const resource = event?.resource || {};
    const subscriptionId = resource.id || resource.billing_agreement_id;
    if (!subscriptionId) return res.status(200).json({ ok: true });

    const user = await User.findOne({ paypalSubscriptionId: subscriptionId });
    if (!user) return res.status(200).json({ ok: true }); // no es (o ya no es) de OZAMA

    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        user.plan = 'premium';
        user.subscriptionStatus = 'active';
        if (resource.billing_info?.next_billing_time) {
          user.premiumUntil = new Date(resource.billing_info.next_billing_time);
        }
        await user.save({ validateModifiedOnly: true });
        break;
      }
      case 'PAYMENT.SALE.COMPLETED': {
        // Renovacion mensual cobrada -- extender la fecha si PayPal
        // volvio a mandar next_billing_time, si no, +31 dias de colchon.
        user.subscriptionStatus = 'active';
        user.plan = 'premium';
        const fallback = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
        user.premiumUntil = resource.billing_info?.next_billing_time
          ? new Date(resource.billing_info.next_billing_time)
          : fallback;
        await user.save({ validateModifiedOnly: true });
        break;
      }
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        user.subscriptionStatus = 'past_due';
        await user.save({ validateModifiedOnly: true });
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        user.subscriptionStatus = 'cancelled';
        // El plan se degrada solo, no de una: dejamos que
        // premiumUntil (ya pago) siga corriendo su curso -- lo revisa
        // premiumCapabilities() en routes/user.js, no hace falta
        // bajarle el plan a 'free' aca mismo.
        await user.save({ validateModifiedOnly: true });
        break;
      }
      default:
        break;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Billing] webhook error:', err.message);
    res.status(200).json({ ok: true }); // PayPal reintenta si no es 2xx -- no queremos reintentos infinitos por un bug nuestro
  }
});

module.exports = router;
