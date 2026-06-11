const stripe = require('stripe')(process.env.AK2);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { paymentIntentId, amount } = req.body;
    if (!paymentIntentId || !amount) return res.status(400).json({ error: 'Missing params' });

    await stripe.paymentIntents.update(paymentIntentId, {
      amount: Math.round(amount * 100)
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
