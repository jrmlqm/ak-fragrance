const stripe = require('stripe')(process.env.AK2);
const { computeOrder, PricingError } = require('./_pricing');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { items, deliveryType, promoCode, customerEmail, customerName } = req.body;
    const order = await computeOrder({ items, deliveryType, promoCode });
    if (order.total < 0.50) return res.status(400).json({ error: 'Montant invalide' });
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(order.total * 100),
      currency: 'eur',
      receipt_email: customerEmail || undefined,
      metadata: {
        customer_name: customerName || '',
        delivery: deliveryType,
        promo: (promoCode || '').toUpperCase(),
        items_summary: order.lines.map(i => `${i.name} x${i.qty}`).join(', ').substring(0, 500)
      },
      automatic_payment_methods: { enabled: true },
    });
    return res.status(200).json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id, ...order });
  } catch (err) {
    if (err instanceof PricingError) return res.status(400).json({ error: err.message });
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
