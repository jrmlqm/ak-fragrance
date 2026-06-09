const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const { amount, currency, customerEmail, customerName, items } = JSON.parse(event.body);

    if (!amount || amount < 50) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Montant invalide' }) };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // en centimes
      currency: currency || 'eur',
      receipt_email: customerEmail,
      metadata: {
        customer_name: customerName || '',
        items_count: items?.length || 0,
        items_summary: items?.map(i => `${i.name} x${i.qty}`).join(', ').substring(0, 500) || ''
      },
      automatic_payment_methods: { enabled: true },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
