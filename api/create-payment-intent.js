const stripe = require('stripe')(process.env.AK2);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { amount, currency, customerEmail, customerName, items } = req.body;
    if (!amount || amount < 0.50) return res.status(400).json({ error: 'Montant invalide' });
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: currency || 'eur',
      receipt_email: customerEmail,
      metadata: { customer_name: customerName || '', items_summary: items?.map(i => `${i.name} x${i.qty}`).join(', ').substring(0, 500) || '' },
      automatic_payment_methods: { enabled: true },
    });
    return res.status(200).json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
