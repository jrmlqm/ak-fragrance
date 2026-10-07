const stripe = require('stripe')(process.env.AK2);
const { computeOrder, PricingError } = require('./_pricing');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { paymentIntentId, items, deliveryType, promoCode } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'Missing params' });
    const order = await computeOrder({ items, deliveryType, promoCode });
    if (order.total < 0.50) return res.status(400).json({ error: 'Montant invalide' });

    await stripe.paymentIntents.update(paymentIntentId, {
      amount: Math.round(order.total * 100),
      metadata: { delivery: deliveryType, promo: (promoCode || '').toUpperCase() }
    });

    return res.status(200).json({ success: true, ...order });
  } catch (err) {
    if (err instanceof PricingError) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
};
