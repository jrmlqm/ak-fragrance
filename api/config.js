// Clé publique Stripe lue depuis Vercel (variable STRIPE_PUBLISHABLE_KEY) :
// passer du mode test au mode réel se fait sans toucher au code.
// Elle doit être du même mode que la clé secrète AK2 (pk_test/sk_test ou pk_live/sk_live).
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
};
