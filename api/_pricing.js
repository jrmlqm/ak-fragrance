// Calcul du montant d'une commande côté serveur.
// Le navigateur n'envoie que les produits, quantités, livraison et code promo :
// les prix sont relus dans Supabase pour qu'un client ne puisse pas les modifier.
// (Le préfixe "_" empêche Vercel d'exposer ce fichier comme une route.)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vuqukiuxzplvaavctypm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_tgw32oQkZeOwmTvTHpEuog_oIQYla2_';

// Doit rester identique aux options affichées dans index.html (page paiement)
const DELIVERY_COSTS = { standard: 0, express: 9.90, relay: 3.90 };

// Doit rester identique aux codes acceptés dans app.js
function promoDiscount(code, subtotal) {
  switch ((code || '').trim().toUpperCase()) {
    case 'AK10': return Math.round(subtotal * 0.10);
    case 'BIENVENUE': return 15;
    default: return 0;
  }
}

class PricingError extends Error {}

async function computeOrder({ items, deliveryType, promoCode }) {
  if (!Array.isArray(items) || !items.length) throw new PricingError('Panier vide');
  if (!(deliveryType in DELIVERY_COSTS)) throw new PricingError('Mode de livraison invalide');

  const ids = [...new Set(items.map(i => Number(i.id)))];
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) throw new PricingError('Produit invalide dans le panier');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?id=in.(${ids.join(',')})&select=id,name,price,sizes,badge`, {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
  });
  if (!res.ok) throw new Error('Catalogue indisponible');
  const products = new Map((await res.json()).map(p => [p.id, p]));

  let subtotal = 0;
  const lines = items.map(item => {
    const p = products.get(Number(item.id));
    if (!p) throw new PricingError(`« ${item.name || 'Produit'} » n'est plus disponible, retirez-le du panier`);
    if (p.badge === 'out') throw new PricingError(`« ${p.name} » est en rupture de stock`);
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new PricingError('Quantité invalide');

    // Le prix demandé doit être le prix du produit ou celui d'une de ses tailles
    const validPrices = [p.price, ...(Array.isArray(p.sizes) ? p.sizes.map(s => s.price) : [])]
      .map(Number).filter(n => n > 0);
    const price = Number(item.price);
    if (!validPrices.includes(price)) throw new PricingError(`Le prix de « ${p.name} » a changé, retirez-le puis ajoutez-le à nouveau au panier`);

    subtotal += price * qty;
    return { id: p.id, name: p.name, price, qty };
  });

  const deliveryCost = DELIVERY_COSTS[deliveryType];
  const discount = Math.min(promoDiscount(promoCode, subtotal), subtotal);
  const total = Math.round((subtotal + deliveryCost - discount) * 100) / 100;
  return { lines, subtotal, deliveryCost, discount, total };
}

module.exports = { computeOrder, PricingError };
