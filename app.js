const SUPABASE_URL = 'https://vuqukiuxzplvaavctypm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tgw32oQkZeOwmTvTHpEuog_oIQYla2_';

let products = [];
let allBrands = [];
let cart = [];
let favorites = [];
let currentUser = null;
let accessToken = null;
let stripeInstance = null;
let stripeElements = null;
let currentClientSecret = null;
let currentPaymentIntentId = null;

/* ══════════════════════════════
   SUPABASE HELPERS
══════════════════════════════ */
async function sbGet(path, token = null) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + (token || SUPABASE_KEY)
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbPost(path, body, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

async function sbPatch(path, body, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

async function sbDelete(path, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbAuth(endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Erreur');
  return data;
}

/* ══════════════════════════════
   INIT
══════════════════════════════ */
async function loadData() {
  try {
    [products, allBrands] = await Promise.all([
      sbGet('products?order=id'),
      sbGet('brands?order=name')
    ]);
    try {
      const settings = await sbGet('settings');
      applySettings(settings);
    } catch(e) {}
    renderAll();
    await checkSession();
    connectRealtime();
  } catch (e) {
    notif('Erreur de chargement');
    console.error(e);
  } finally {
    document.getElementById('loading').classList.add('hidden');
  }
}

function applySettings(settings) {
  const map = {};
  settings.forEach(s => { map[s.key] = s.value; });
  if (map.hero_image) {
    const hero = document.querySelector('.hero');
    if (hero) {
      hero.style.backgroundImage = `url(${map.hero_image})`;
      hero.style.backgroundSize = 'cover';
      hero.style.backgroundPosition = 'center';
    }
  }
  document.querySelectorAll('.cat-card[data-cat]').forEach(card => {
    const key = 'cat_bg_' + card.dataset.cat;
    if (map[key]) {
      card.style.backgroundImage = `url(${map[key]})`;
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
    }
  });
}

async function checkSession() {
  const session = JSON.parse(localStorage.getItem('ak_session') || 'null');
  if (!session || !session.access_token) return;

  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    const isExpired = payload.exp * 1000 < Date.now();

    if (isExpired && session.refresh_token) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      if (res.ok) {
        const newSession = await res.json();
        localStorage.setItem('ak_session', JSON.stringify(newSession));
        currentUser = newSession.user;
        accessToken = newSession.access_token;
      } else {
        localStorage.removeItem('ak_session');
        return;
      }
    } else if (isExpired) {
      localStorage.removeItem('ak_session');
      return;
    } else {
      currentUser = session.user;
      accessToken = session.access_token;
    }
  } catch (e) {
    currentUser = session.user;
    accessToken = session.access_token;
  }

  updateAccountUI();
  await loadUserData();
}

async function loadUserData() {
  if (!currentUser || !accessToken) return;
  try {
    const [cartItems, favItems] = await Promise.all([
      sbGet(`cart_items?user_id=eq.${currentUser.id}&order=created_at`, accessToken),
      sbGet(`favorites?user_id=eq.${currentUser.id}&order=created_at`, accessToken)
    ]);
    cart = cartItems.map(i => ({
      dbId: i.id,
      id: i.product_id || i.id,
      name: i.name,
      brand: i.brand,
      price: i.price,
      img: i.img || 'p1',
      imageUrl: i.image_url || '',
      qty: i.qty
    }));
    favorites = favItems.map(i => ({
      dbId: i.id,
      productId: i.product_id,
      name: i.name,
      price: i.price,
      img: i.img || 'p1',
      imageUrl: i.image_url || ''
    }));
    updateCartBadge();
    renderCart();
    renderFavorites();
    loadOrders();
  } catch (e) {
    console.error('loadUserData:', e);
  }
}

async function loadOrders() {
  if (!currentUser || !accessToken) return;
  try {
    const orders = await sbGet(`orders?user_id=eq.${currentUser.id}&order=created_at.desc`, accessToken);
    renderOrders(orders);
  } catch (e) {
    console.error('loadOrders:', e);
  }
}

function renderOrders(orders) {
  const el = document.getElementById('orders-list');
  if (!el) return;
  if (!orders || !orders.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--text-muted);padding:8px 0">Aucune commande pour le moment.</p>';
    return;
  }

  const statusLabel = { confirmed:'Confirmée', shipped:'Expédiée', delivered:'Livrée', cancelled:'Annulée' };
  const statusColor = { confirmed:'#4A7A4A', shipped:'#8A6E58', delivered:'#4A7A4A', cancelled:'#9A3A3A' };
  const deliveryLabel = { standard:'Colissimo Standard', express:'Chronopost Express', relay:'Point Relais' };

  el.innerHTML = orders.map(order => {
    const date = new Date(order.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
    const ref = (order.stripe_payment_intent_id || order.id || '').slice(-8).toUpperCase();
    const items = Array.isArray(order.items) ? order.items : [];
    const status = order.status || 'confirmed';

    return `<div style="padding:20px 0;border-bottom:1px solid rgba(138,110,88,0.12)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div>
          <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--brown-light);margin-bottom:4px">${date}</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:300;color:var(--brown-dark)">Commande #${ref}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:5px 12px;border:1px solid ${statusColor[status]||'#8A6E58'};color:${statusColor[status]||'#8A6E58'}">${statusLabel[status]||status}</span>
          <span style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:300;color:var(--brown-dark)">${order.total} €</span>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${items.map(i => `<span style="font-size:10px;color:var(--text-muted);padding:4px 10px;background:var(--beige-light);letter-spacing:0.5px">${i.name} ×${i.qty}</span>`).join('')}
      </div>
      <div style="font-size:10px;color:var(--brown-light);letter-spacing:1px">${deliveryLabel[order.delivery_type]||'Livraison standard'}${order.address ? ' · '+order.address : ''}</div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════
   AUTHENTIFICATION
══════════════════════════════ */
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('login-msg');
  msg.className = 'auth-msg';
  msg.textContent = '';
  if (!email || !password) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Veuillez remplir tous les champs.';
    return;
  }
  try {
    const data = await sbAuth('token?grant_type=password', { email, password });
    localStorage.setItem('ak_session', JSON.stringify(data));
    currentUser = data.user;
    accessToken = data.access_token;
    updateAccountUI();
    await loadUserData();
    closeAuth();
    const firstname = currentUser.user_metadata?.firstname || email.split('@')[0];
    notif(`Bienvenue ${firstname} ! ✓`);
    showPage('account');
  } catch (e) {
    msg.className = 'auth-msg error';
    msg.textContent = e.message.includes('Invalid') ? 'Email ou mot de passe incorrect.' : e.message;
  }
}

async function doRegister() {
  const firstname = document.getElementById('reg-firstname').value.trim();
  const lastname = document.getElementById('reg-lastname').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const msg = document.getElementById('register-msg');
  msg.className = 'auth-msg';
  msg.textContent = '';
  if (!firstname || !lastname || !email || !password) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Veuillez remplir tous les champs obligatoires.';
    return;
  }
  if (password.length < 6) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Le mot de passe doit contenir au moins 6 caractères.';
    return;
  }
  try {
    const data = await sbAuth('signup', { email, password, data: { firstname, lastname, phone } });
    localStorage.setItem('ak_session', JSON.stringify(data));
    currentUser = data.user;
    accessToken = data.access_token;
    updateAccountUI();
    closeAuth();
    notif(`Bienvenue ${firstname} ! Votre compte a été créé ✓`);
    showPage('account');
  } catch (e) {
    msg.className = 'auth-msg error';
    msg.textContent = e.message.includes('already') ? 'Un compte existe déjà avec cet email.' : e.message;
  }
}

async function doLogout() {
  cart = [];
  favorites = [];
  currentUser = null;
  accessToken = null;
  localStorage.removeItem('ak_session');
  updateAccountUI();
  updateCartBadge();
  renderCart();
  renderFavorites();
  showPage('home');
  notif('Vous êtes déconnecté(e)');
}

function updateAccountUI() {
  const btn = document.getElementById('account-btn');
  const connected = document.getElementById('account-connected');
  const disconnected = document.getElementById('account-disconnected');
  if (currentUser) {
    btn.style.background = 'rgba(90,70,53,0.12)';
    btn.querySelector('svg').style.stroke = 'var(--brown-dark)';
    const email = currentUser.email || '';
    const firstname = currentUser.user_metadata?.firstname || '';
    const lastname = currentUser.user_metadata?.lastname || '';
    const name = [firstname, lastname].filter(Boolean).join(' ') || email.split('@')[0];
    if (document.getElementById('account-email-display')) document.getElementById('account-email-display').textContent = email;
    if (document.getElementById('account-name-display')) document.getElementById('account-name-display').textContent = name;
    if (document.getElementById('acc-firstname')) document.getElementById('acc-firstname').value = firstname;
    if (document.getElementById('acc-lastname')) document.getElementById('acc-lastname').value = currentUser.user_metadata?.lastname || '';
    if (document.getElementById('acc-email')) document.getElementById('acc-email').value = email;
    if (document.getElementById('acc-phone')) document.getElementById('acc-phone').value = currentUser.user_metadata?.phone || '';
    if (document.getElementById('acc-address')) document.getElementById('acc-address').value = currentUser.user_metadata?.address || '';
    if (connected) connected.style.display = 'block';
    if (disconnected) disconnected.style.display = 'none';
    ['nl-email', 'nl-email-histoire'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = email;
    });
  } else {
    btn.style.background = '';
    btn.querySelector('svg').style.stroke = '';
    if (connected) connected.style.display = 'none';
    if (disconnected) disconnected.style.display = 'block';
    ['nl-email', 'nl-email-histoire'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
}

function handleAccountClick() { if (currentUser) { showPage('account'); } else { openAuth('login'); } }
function openFavProduct(productId) {
  if (productId) openProduct(productId);
}

function handleFavClick() { if (currentUser) { showPage('favorites'); } else { openAuth('login'); notif('Connectez-vous pour voir vos favoris'); } }

/* ── AUTH MODAL ── */
function openAuth(tab = 'login') {
  switchAuthTab(tab, document.querySelectorAll('.auth-tab')[tab === 'login' ? 0 : 1]);
  document.getElementById('login-msg').textContent = '';
  document.getElementById('register-msg').textContent = '';
  document.getElementById('auth-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuth() { document.getElementById('auth-overlay').classList.remove('open'); document.body.style.overflow = ''; }
function closeAuthIfOutside(e) { if (e.target === document.getElementById('auth-overlay')) closeAuth(); }
function switchAuthTab(name, btn) {
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('auth-' + name).classList.add('active');
}

/* ══════════════════════════════
   FAVORIS
══════════════════════════════ */
async function quickAddFav(name, price, productId, img, imageUrl) {
  if (!currentUser) { openAuth('login'); notif('Connectez-vous pour ajouter aux favoris'); return; }
  if (favorites.find(f => f.productId === productId)) { notif('Déjà dans vos favoris'); return; }
  try {
    const res = await sbPost('favorites', {
      user_id: currentUser.id,
      product_id: productId,
      name, price,
      img: img || 'p1',
      image_url: imageUrl || null
    }, accessToken);
    favorites.push({ dbId: res[0]?.id, productId, name, price, img: img || 'p1', imageUrl: imageUrl || '' });
    renderFavorites();
    notif('Ajouté aux favoris ♡');
  } catch (e) { notif('Erreur favoris : ' + e.message); }
}

async function addToWish() {
  const name = document.getElementById('prod-name').textContent;
  const price = parseInt(document.getElementById('prod-price').textContent);
  const imgEl = document.getElementById('prod-main-img').querySelector('img');
  const p = products.find(x => x.name === name);
  await quickAddFav(name, price, p?.id, p?.img, imgEl?.src || '');
}

async function removeFav(dbId) {
  try {
    await sbDelete(`favorites?id=eq.${dbId}`, accessToken);
    favorites = favorites.filter(f => f.dbId !== dbId);
    renderFavorites();
  } catch (e) { notif('Erreur : ' + e.message); }
}

function renderFavorites() {
  const el = document.getElementById('fav-list');
  if (!el) return;
  if (!favorites.length) {
    el.innerHTML = '<p style="text-align:center;font-size:13px;color:var(--text-muted);padding:60px 0">Aucun favori pour le moment.</p>';
    return;
  }
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(138,110,88,0.1)">` +
    favorites.map(f => `
    <div style="background:var(--beige-light);cursor:pointer;position:relative" onclick="openFavProduct(${f.productId})">
      <div style="aspect-ratio:3/4;overflow:hidden;position:relative">
        ${f.imageUrl
          ? `<img src="${f.imageUrl}" alt="${f.name}" style="width:100%;height:100%;object-fit:cover">`
          : `<div style="width:100%;height:100%;background:${swatchBgs[f.img] || swatchBgs.p1}"></div>`}
        <button onclick="event.stopPropagation();removeFav(${f.dbId})"
          style="position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.9);border:none;cursor:pointer;font-size:12px;color:var(--brown-dark);display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div style="padding:16px">
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--brown-light);margin-bottom:4px">${f.brand||''}</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:300;color:var(--brown-dark);margin-bottom:6px">${f.name}</div>
        <div style="font-size:13px;font-weight:500;color:var(--brown-dark);margin-bottom:12px">${f.price} €</div>
        <button class="btn-cart" onclick="event.stopPropagation();addToCartDirect('${f.name}','${f.brand||''}',${f.price},${f.productId},'${f.img}','${f.imageUrl}')">
          Ajouter au panier
        </button>
      </div>
    </div>`).join('') + `</div>`;
}

/* ══════════════════════════════
   PANIER
══════════════════════════════ */
async function addToCartDirect(name, brand, price, productId, img, imageUrl) {
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    existing.qty++;
    if (currentUser && existing.dbId) {
      try { await sbPatch(`cart_items?id=eq.${existing.dbId}`, { qty: existing.qty }, accessToken); } catch (e) {}
    }
  } else {
    const item = { id: productId || Date.now(), name, brand, price, img: img || 'p1', imageUrl: imageUrl || '', qty: 1 };
    if (currentUser) {
      try {
        const res = await sbPost('cart_items', {
          user_id: currentUser.id,
          product_id: productId || null,
          name, brand, price,
          img: img || 'p1',
          image_url: imageUrl || null,
          qty: 1
        }, accessToken);
        item.dbId = res[0]?.id;
      } catch (e) { console.error(e); }
    }
    cart.push(item);
  }
  updateCartBadge();
  notif('Ajouté au panier — ' + name);
  renderCart();
}

async function addToCartProduct() {
  const name = document.getElementById('prod-name').textContent;
  const brand = document.getElementById('prod-brand').textContent;
  const imgEl = document.getElementById('prod-main-img').querySelector('img');
  const p = products.find(x => x.name === name);
  await addToCartDirect(name, brand, currentProductPrice, p?.id, p?.img, imgEl?.src || '');
}

async function removeFromCart(idx) {
  const item = cart[idx];
  if (currentUser && item.dbId) {
    try { await sbDelete(`cart_items?id=eq.${item.dbId}`, accessToken); } catch (e) {}
  }
  cart.splice(idx, 1);
  renderCart();
  updateCartBadge();
}

async function changeQty(idx, delta) {
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) { removeFromCart(idx); return; }
  if (currentUser && cart[idx].dbId) {
    try { await sbPatch(`cart_items?id=eq.${cart[idx].dbId}`, { qty: cart[idx].qty }, accessToken); } catch (e) {}
  }
  renderCart();
  updateCartBadge();
}

function updateCartBadge() {
  document.getElementById('cart-count').textContent = cart.reduce((s, i) => s + i.qty, 0);
}

function renderCart() {
  const list = document.getElementById('cart-list');
  if (cart.length === 0) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-muted);padding:40px 0">Votre panier est vide.</p>';
    ['cart-subtotal', 'cart-total'].forEach(id => document.getElementById(id).textContent = '0 €');
    document.getElementById('cart-livraison').textContent = '—';
    document.getElementById('livraison-note').textContent = '';
    return;
  }
  list.innerHTML = cart.map((item, idx) => `
    <div class="cart-item">
      ${item.imageUrl
        ? `<img class="cart-item-img" src="${item.imageUrl}" alt="${item.name}">`
        : `<div class="cart-item-img" style="background:${swatchBgs[item.img] || swatchBgs.p1}"></div>`}
      <div style="flex:1">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-sub">${item.brand}</div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty(${idx},-1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${idx},1)">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <div style="font-size:18px;font-weight:300;color:var(--brown-dark)">${item.price * item.qty} €</div>
        <button class="remove-item" onclick="removeFromCart(${idx})">✕</button>
      </div>
    </div>`).join('');

  const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const liv = sub >= 150 ? 0 : 9.9;
  document.getElementById('cart-subtotal').textContent = sub + ' €';
  document.getElementById('cart-livraison').textContent = liv === 0 ? 'Offerte' : liv.toFixed(2) + ' €';
  document.getElementById('cart-total').textContent = (sub + liv).toFixed(0) + ' €';
  document.getElementById('livraison-note').textContent =
    sub > 0 && sub < 150 ? `Plus que ${150 - sub}€ pour la livraison offerte` :
    sub >= 150 ? '✓ Livraison offerte appliquée' : '';
}

function applyPromo() {
  const c = document.getElementById('promo-input').value.trim().toUpperCase();
  if (c === 'AK10') { document.getElementById('cart-promo-val').textContent = '-10%'; notif('Code AK10 appliqué'); }
  else if (c === 'BIENVENUE') { document.getElementById('cart-promo-val').textContent = '-15€'; notif('Code BIENVENUE appliqué'); }
  else { notif('Code invalide'); }
}

/* ══════════════════════════════
   CHECKOUT
══════════════════════════════ */
function checkout() {
  if (!currentUser) { openAuth('login'); notif('Connectez-vous pour passer commande'); return; }
  if (cart.length === 0) { notif('Votre panier est vide'); return; }
  openCheckout();
}

function openCheckout() {
  if (currentUser) {
    const m = currentUser.user_metadata || {};
    const fn = document.getElementById('co-firstname'); if (fn) fn.value = m.firstname || '';
    const ln = document.getElementById('co-lastname'); if (ln) ln.value = m.lastname || '';
    const em = document.getElementById('co-email'); if (em) em.value = currentUser.email || '';
    const ph = document.getElementById('co-phone'); if (ph) ph.value = m.phone || '';
  }
  checkoutDeliveryCost = 0;
  checkoutPromoDiscount = 0;
  document.getElementById('co-promo-msg').textContent = '';
  document.getElementById('co-promo-line').style.display = 'none';
  document.getElementById('co-promo').value = '';
  document.querySelectorAll('.delivery-option').forEach((o, i) => o.classList.toggle('selected', i === 0));
  stripeElements = null;
  currentClientSecret = null;
  currentPaymentIntentId = null;
  const stripeEl = document.getElementById('stripe-payment-element');
  if (stripeEl) stripeEl.innerHTML = '';
  renderCheckoutSummary();
  showPage('checkout');
  setTimeout(initPaymentForm, 100);
}

let checkoutDeliveryCost = 0;
let checkoutPromoDiscount = 0;

function selectDelivery(el, type, cost) {
  document.querySelectorAll('.delivery-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  checkoutDeliveryCost = cost;
  renderCheckoutSummary();
  updateStripeAmount();
}

function applyCheckoutPromo() {
  const code = document.getElementById('co-promo').value.trim().toUpperCase();
  const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const msg = document.getElementById('co-promo-msg');
  if (code === 'AK10') {
    checkoutPromoDiscount = Math.round(sub * 0.10);
    msg.style.color = 'var(--brown)';
    msg.textContent = '✓ Code AK10 appliqué — 10% de réduction';
    document.getElementById('co-promo-line').style.display = 'flex';
  } else if (code === 'BIENVENUE') {
    checkoutPromoDiscount = 15;
    msg.style.color = 'var(--brown)';
    msg.textContent = '✓ Code BIENVENUE appliqué — 15€ de réduction';
    document.getElementById('co-promo-line').style.display = 'flex';
  } else {
    checkoutPromoDiscount = 0;
    msg.style.color = '#9A3A3A';
    msg.textContent = 'Code invalide';
    document.getElementById('co-promo-line').style.display = 'none';
  }
  renderCheckoutSummary();
  updateStripeAmount();
}

function calculateCheckoutTotal() {
  const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  return Math.max(0, sub + checkoutDeliveryCost - checkoutPromoDiscount);
}

function renderCheckoutSummary() {
  const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const total = calculateCheckoutTotal();
  document.getElementById('co-subtotal').textContent = sub + ' €';
  document.getElementById('co-delivery-line').textContent = checkoutDeliveryCost === 0 ? 'Offerte' : checkoutDeliveryCost.toFixed(2) + ' €';
  document.getElementById('co-promo-amount').textContent = '-' + checkoutPromoDiscount + ' €';
  document.getElementById('co-total').textContent = total + ' €';
  document.getElementById('co-total-btn').textContent = total + ' €';
  const items = document.getElementById('checkout-items');
  if (items) items.innerHTML = cart.map(item => `
    <div class="checkout-item">
      ${item.imageUrl
        ? `<img class="checkout-item-img" src="${item.imageUrl}" alt="${item.name}">`
        : `<div class="checkout-item-img" style="background:${swatchBgs[item.img] || swatchBgs.p1}"></div>`}
      <div style="flex:1">
        <div class="checkout-item-name">${item.name}</div>
        <div class="checkout-item-brand">${item.brand}</div>
        <div class="checkout-item-qty">Qté : ${item.qty}</div>
      </div>
      <div class="checkout-item-price">${item.price * item.qty} €</div>
    </div>`).join('');
}

/* ── FORMULAIRE DE PAIEMENT (STRIPE) ── */
async function initPaymentForm() {
  const el = document.getElementById('stripe-payment-element');
  if (!el) return;

  el.innerHTML = '<div style="padding:20px;text-align:center;font-size:10px;letter-spacing:2px;color:var(--text-muted);text-transform:uppercase">Chargement du formulaire...</div>';

  if (!stripeInstance) stripeInstance = Stripe('pk_test_51Tg6AeGtJjq6z10aakr3XknFkweXR1cDg0sUakztGVqeqJgHYPML823KsGI5nY0I4lVZ483h07eHU2TK9MEO9s6B00dDsZ3Inv');

  try {
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: calculateCheckoutTotal(),
        currency: 'eur',
        customerEmail: document.getElementById('co-email')?.value || '',
        customerName: [document.getElementById('co-firstname')?.value, document.getElementById('co-lastname')?.value].filter(Boolean).join(' '),
        items: cart.map(i => ({ name: i.name, qty: i.qty }))
      })
    });
    const { clientSecret, paymentIntentId, error: apiError } = await res.json();
    if (apiError) throw new Error(apiError);

    currentClientSecret = clientSecret;
    currentPaymentIntentId = paymentIntentId;

    const appearance = {
      theme: 'stripe',
      variables: {
        colorPrimary: '#5A4635',
        colorBackground: '#FDFAF5',
        colorText: '#4A3828',
        colorTextSecondary: '#9A8878',
        colorDanger: '#9A3A3A',
        fontFamily: '"Jost", sans-serif',
        borderRadius: '0px',
        spacingUnit: '5px',
        fontSizeBase: '13px'
      },
      rules: {
        '.Input': { border: '1px solid rgba(138,110,88,0.2)', boxShadow: 'none', padding: '12px 14px' },
        '.Input:focus': { border: '1px solid #8A6E58', boxShadow: 'none' },
        '.Label': { fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', color: '#B09A88' }
      }
    };

    stripeElements = stripeInstance.elements({ clientSecret, appearance });
    const paymentElement = stripeElements.create('payment', { layout: 'accordion' });
    el.innerHTML = '';
    paymentElement.mount(el);

  } catch (e) {
    el.innerHTML = `<div style="color:#9A3A3A;font-size:12px;padding:12px">${e.message}</div>`;
  }
}

async function updateStripeAmount() {
  if (!currentPaymentIntentId) return;
  try {
    await fetch('/api/update-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId: currentPaymentIntentId, amount: calculateCheckoutTotal() })
    });
    if (stripeElements) await stripeElements.fetchUpdates();
  } catch (e) {
    console.error('updateStripeAmount:', e);
  }
}

async function placeOrder() {
  const required = ['co-firstname', 'co-lastname', 'co-email', 'co-address', 'co-zip', 'co-city'];
  for (const id of required) {
    if (!document.getElementById(id)?.value.trim()) {
      notif('Veuillez remplir tous les champs obligatoires');
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById(id)?.focus();
      return;
    }
  }

  if (!stripeElements || !currentClientSecret) { notif('Le formulaire de paiement n\'est pas prêt'); return; }

  const errEl = document.getElementById('stripe-error');
  errEl.textContent = '';

  const btn = document.querySelector('#page-checkout .add-cart-big');
  const total = calculateCheckoutTotal();
  btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px"></span>Traitement en cours...';
  btn.disabled = true;

  try {
    const { error } = await stripeInstance.confirmPayment({
      elements: stripeElements,
      confirmParams: { return_url: window.location.origin },
      redirect: 'if_required'
    });

    if (error) {
      errEl.textContent = error.message;
      btn.innerHTML = `Confirmer et payer — <span id="co-total-btn">${total} €</span>`;
      btn.disabled = false;
      return;
    }

    await saveOrder(currentPaymentIntentId);
    sendConfirmationEmail().catch(e => console.error('email:', e));

    if (currentUser && accessToken) {
      for (const item of cart) {
        if (item.dbId) try { await sbDelete('cart_items?id=eq.' + item.dbId, accessToken); } catch (e) {}
      }
    }
    cart = [];
    updateCartBadge();
    renderCart();
    showPage('confirmation');

  } catch (e) {
    errEl.textContent = e.message;
    btn.innerHTML = `Confirmer et payer — <span id="co-total-btn">${total} €</span>`;
    btn.disabled = false;
  }
}

/* ══════════════════════════════
   REALTIME
══════════════════════════════ */
function connectRealtime() {
  try {
    const ws = new WebSocket(`wss://vuqukiuxzplvaavctypm.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ topic: 'realtime:public:products', event: 'phx_join', payload: {}, ref: '1' }));
      ws.send(JSON.stringify({ topic: 'realtime:public:brands', event: 'phx_join', payload: {}, ref: '2' }));
    };
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.event === 'phx_reply') return;
      if (msg.topic && (msg.topic.includes('products') || msg.topic.includes('brands'))) {
        [products, allBrands] = await Promise.all([sbGet('products?order=id'), sbGet('brands?order=name')]);
        renderAll();
      }
    };
    ws.onclose = () => setTimeout(connectRealtime, 3000);
  } catch (e) {}
}

/* ══════════════════════════════
   RENDU PRODUITS
══════════════════════════════ */
const swatchBgs = {
  p1: 'linear-gradient(160deg,#E8D0B0,#C4A070)',
  p2: 'linear-gradient(160deg,#F0D8B8,#D0A878)',
  p3: 'linear-gradient(160deg,#D8C8A0,#B09060)',
  p4: 'linear-gradient(160deg,#F4DEC0,#D8B080)',
  p5: 'linear-gradient(160deg,#E0C8A0,#B89060)',
  p6: 'linear-gradient(160deg,#F8E8C8,#DEC090)',
  p7: 'linear-gradient(160deg,#D0B898,#A88860)',
  p8: 'linear-gradient(160deg,#FCEEDD,#E8C898)'
};

function starsHTML(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

const badgeMap = { new: 'Nouveau', best: 'Best Seller', out: 'Rupture' };

function productCardHTML(p) {
  const bg = swatchBgs[p.img] || swatchBgs.p1;
  const badge = p.badge ? `<div class="product-badge badge-${p.badge}">${badgeMap[p.badge] || p.badge}</div>` : '';
  const mainImg = (p.images && p.images[0]) || p.image_url;
  const imgHTML = mainImg
    ? `<img class="product-img-photo" src="${mainImg}" alt="${p.name}">`
    : `<div class="product-img-inner" style="background:${bg}"></div>`;
  const firstSize = p.sizes && p.sizes[0];
  const displayPrice = firstSize ? firstSize.price : p.price;
  const displayPromo = firstSize ? firstSize.promo_price : p.promo_price;
  const priceHTML = displayPromo
    ? `<div class="product-price"><span style="text-decoration:line-through;font-size:11px;color:var(--text-muted);margin-right:5px">${displayPromo}€</span>${displayPrice} €</div>`
    : `<div class="product-price">${displayPrice} €</div>`;
  const safeName = (p.name || '').replace(/'/g, "\\'");
  const safeBrand = (p.brand || '').replace(/'/g, "\\'");
  const useImg = mainImg || '';
  return `<div class="product-card" onclick="openProduct(${p.id})">
    <div class="product-img">${badge}${imgHTML}</div>
    <div class="product-info">
      <div class="product-brand">${p.brand}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-stars">${starsHTML(p.stars || 5)}</div>
      ${priceHTML}
      <div class="product-actions">
        <button class="btn-cart"
          onclick="event.stopPropagation();addToCartDirect('${safeName}','${safeBrand}',${p.price},${p.id},'${p.img || 'p1'}','${useImg}')">
          Ajouter
        </button>
        <button class="btn-fav" aria-label="Favoris"
          onclick="event.stopPropagation();quickAddFav('${safeName}',${p.price},${p.id},'${p.img || 'p1'}','${useImg}')">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21C12 21 3 14.5 3 8.5a4.5 4.5 0 0 1 9-0.5 4.5 4.5 0 0 1 9 .5c0 6-9 12.5-9 12.5z"/>
          </svg>
        </button>
      </div>
    </div>
  </div>`;
}

function renderAll() {
  const hb = document.getElementById('home-brands');
  if (hb) {
    const featured = allBrands.filter(b => b.featured);
    const toShow = featured.length ? featured : allBrands.slice(0, 4);
    hb.innerHTML = toShow.map(b =>
      `<div class="brand-card" onclick="showPage('brands')"><div class="brand-name">${b.name}</div><div class="brand-desc">${b.description}</div></div>`
    ).join('');
  }

  const hp = document.getElementById('home-products');
  if (hp) hp.innerHTML = products.slice(0, 8).map(productCardHTML).join('');

  const np = document.getElementById('new-products');
  if (np) np.innerHTML = products.filter(p => p.is_new || p.badge === 'new').map(productCardHTML).join('');

  const bf = document.getElementById('brands-full');
  if (bf) bf.innerHTML = allBrands.map(b =>
    `<div class="brand-card" onclick="showPage('shop')"><div class="brand-name">${b.name}</div><div class="brand-desc">${b.description}</div></div>`
  ).join('');

  const bfilt = document.getElementById('brand-filters');
  if (bfilt) bfilt.innerHTML = allBrands.map(b =>
    `<label class="filter-check"><input type="checkbox" value="${b.name}" onchange="filterShop()"><span>${b.name}</span></label>`
  ).join('');

  renderNoteFilters();

  // Adjust price range max to fit actual product prices
  if (products.length) {
    const maxPrice = Math.max(...products.map(p => Number(p.price) || 0));
    const sliderMax = Math.ceil(maxPrice / 100) * 100 || 500;
    const slider = document.querySelector('.price-range');
    if (slider) { slider.max = sliderMax; slider.value = sliderMax; }
    const pmaxEl = document.getElementById('pmax');
    if (pmaxEl) pmaxEl.textContent = sliderMax + '€';
  }

  filterShop();
}

function renderNoteFilters() {
  const top = new Set(), heart = new Set(), base = new Set();
  products.forEach(p => {
    (p.notes_top || []).forEach(n => top.add(n));
    (p.notes_heart || []).forEach(n => heart.add(n));
    (p.notes_base || []).forEach(n => base.add(n));
  });
  const makeBoxes = (notes, id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = notes.size
      ? [...notes].sort().map(n => `<label class="filter-check"><input type="checkbox" onchange="filterShop()"><span>${n}</span></label>`).join('')
      : '<span style="font-size:11px;color:var(--text-muted)">—</span>';
  };
  makeBoxes(top, 'notes-top-filters');
  makeBoxes(heart, 'notes-heart-filters');
  makeBoxes(base, 'notes-base-filters');
}

function filterShop() {
  const q = (document.getElementById('shop-search-input')?.value || '').toLowerCase().trim();
  const maxP = parseInt(document.getElementById('pmax')?.textContent) || 500;
  const sort = document.querySelector('.shop-sort select')?.value || 'popular';

  // Get selected brands
  const checkedBrands = [...document.querySelectorAll('#brand-filters input[type=checkbox]:checked')].map(cb => cb.value.toLowerCase());

  // Get selected notes across all pyramid levels
  const getCheckedNotes = id => [...document.querySelectorAll(`#${id} input:checked`)].map(cb => cb.nextElementSibling.textContent);
  const checkedNotes = [...getCheckedNotes('notes-top-filters'), ...getCheckedNotes('notes-heart-filters'), ...getCheckedNotes('notes-base-filters')];

  let list = products.filter(p => {
    const ms = !q || (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q) || (p.notes_top || []).join(' ').toLowerCase().includes(q);
    const mb = checkedBrands.length === 0 || checkedBrands.includes((p.brand || '').toLowerCase());
    const mn = checkedNotes.length === 0 || checkedNotes.some(n => (p.notes_top||[]).includes(n) || (p.notes_heart||[]).includes(n) || (p.notes_base||[]).includes(n));
    return ms && mb && mn && (Number(p.price) || 0) <= maxP;
  });
  if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (sort === 'new') list = [...list.filter(p => p.is_new || p.badge === 'new'), ...list.filter(p => !p.is_new && p.badge !== 'new')];
  const el = document.getElementById('shop-products');
  if (el) el.innerHTML = list.length ? list.map(productCardHTML).join('') : '<div class="no-results">Aucun produit trouvé</div>';
}

let currentProductPrice = 0;

function openProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const bg = swatchBgs[p.img] || swatchBgs.p1;
  currentProductPrice = p.price;

  document.getElementById('prod-brand').textContent = p.brand.toUpperCase();
  document.getElementById('prod-name').textContent = p.name;
  document.getElementById('prod-breadcrumb').textContent = p.name;
  document.getElementById('prod-reviews').textContent = '(' + (p.reviews || 0) + ' avis)';

  // Prix avec promo
  const priceEl = document.getElementById('prod-price');
  if (p.promo_price) {
    priceEl.innerHTML = `<span style="text-decoration:line-through;font-size:16px;color:var(--text-muted);margin-right:8px">${p.promo_price} €</span>${p.price} €`;
  } else {
    priceEl.textContent = p.price + ' €';
  }

  // Images : tableau images[] ou image_url
  const allImgs = (p.images && p.images.length) ? p.images : (p.image_url ? [p.image_url] : []);
  const mainImg = document.getElementById('prod-main-img');
  if (allImgs.length) {
    mainImg.innerHTML = `<img src="${allImgs[0]}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover">`;
    mainImg.style.background = 'none';
  } else {
    mainImg.innerHTML = '<div class="bottle"></div>';
    mainImg.style.background = bg;
  }

  // Galerie thumbnails
  const gallery = document.getElementById('prod-gallery');
  if (gallery) {
    if (allImgs.length > 1) {
      gallery.innerHTML = allImgs.map((url, i) =>
        `<div class="product-thumb${i===0?' active':''}" onclick="switchProductImg('${url}',this)" style="cursor:pointer">
          <img src="${url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover">
        </div>`
      ).join('');
    } else {
      gallery.innerHTML = '';
    }
  }

  // Tailles
  const sizesContainer = document.getElementById('prod-sizes-container');
  if (sizesContainer) {
    const sizes = p.sizes || [];
    if (sizes.length > 0) {
      sizesContainer.innerHTML = sizes.map((s, i) =>
        `<button class="size-btn${i===0?' active':''}" onclick="selectSize(this,${s.price},${s.promo_price||'null'})">${s.ml} ml</button>`
      ).join('');
      currentProductPrice = sizes[0].price;
      if (sizes[0].promo_price) {
        priceEl.innerHTML = `<span style="text-decoration:line-through;font-size:16px;color:var(--text-muted);margin-right:8px">${sizes[0].promo_price} €</span>${sizes[0].price} €`;
      } else {
        priceEl.textContent = sizes[0].price + ' €';
      }
    } else {
      sizesContainer.innerHTML = '';
    }
  }

  document.querySelector('.product-detail .stars').textContent = starsHTML(p.stars || 5);
  document.getElementById('notes-top').innerHTML = (p.notes_top || []).map(n => `<span class="note-tag">${n}</span>`).join('');
  document.getElementById('notes-heart').innerHTML = (p.notes_heart || []).map(n => `<span class="note-tag">${n}</span>`).join('');
  document.getElementById('notes-base').innerHTML = (p.notes_base || []).map(n => `<span class="note-tag">${n}</span>`).join('');

  const descEl = document.getElementById('tab-desc');
  if (descEl) descEl.textContent = p.description || 'Un parfum d\'exception, alliant les matières premières les plus précieuses à un savoir-faire artisanal unique.';
  const ingrEl = document.getElementById('tab-ingr');
  if (ingrEl) ingrEl.textContent = p.ingredients || 'Alcohol Denat., Parfum (Fragrance), Aqua (Water), Linalool, Coumarin, Limonene. Peut contenir des allergènes.';

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(tp => tp.classList.remove('active'));
  document.querySelectorAll('.tab-btn')[0].classList.add('active');
  document.getElementById('tab-desc').classList.add('active');
  document.getElementById('similar-products').innerHTML = products.filter(x => x.id !== id).slice(0, 4).map(productCardHTML).join('');
  showPage('product');
}

function switchProductImg(url, thumb) {
  document.getElementById('prod-main-img').innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">`;
  document.querySelectorAll('#prod-gallery .product-thumb').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
}

function selectSize(btn, price, promoPrice) {
  document.querySelectorAll('#prod-sizes-container .size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (price !== undefined) {
    currentProductPrice = price;
    const priceEl = document.getElementById('prod-price');
    if (promoPrice) {
      priceEl.innerHTML = `<span style="text-decoration:line-through;font-size:16px;color:var(--text-muted);margin-right:8px">${promoPrice} €</span>${price} €`;
    } else {
      priceEl.textContent = price + ' €';
    }
  }
}

/* ══════════════════════════════
   RECHERCHE
══════════════════════════════ */
function openSearch() {
  document.getElementById('search-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('search-global-input').focus(), 100);
}
function closeSearch() {
  document.getElementById('search-overlay').classList.remove('open');
  document.body.style.overflow = '';
  document.getElementById('search-global-input').value = '';
  document.getElementById('search-results').innerHTML = '<div class="search-hint">Tapez pour rechercher dans le catalogue</div>';
}
function closeSearchIfOutside(e) { if (e.target === document.getElementById('search-overlay')) closeSearch(); }

function updateSearchResults(q) {
  const res = document.getElementById('search-results');
  if (!q.trim()) { res.innerHTML = '<div class="search-hint">Tapez pour rechercher dans le catalogue</div>'; return; }
  const matches = products.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.brand.toLowerCase().includes(q.toLowerCase()));
  if (!matches.length) { res.innerHTML = `<div class="search-empty">Aucun résultat pour « ${q} »</div>`; return; }
  res.innerHTML = matches.slice(0, 8).map(p => `
    <div class="search-result-item" onclick="closeSearch();openProduct(${p.id})">
      ${p.image_url
        ? `<img class="search-result-swatch" src="${p.image_url}" alt="${p.name}" style="object-fit:cover">`
        : `<div class="search-result-swatch" style="background:${swatchBgs[p.img] || swatchBgs.p1}"></div>`}
      <div>
        <div class="search-result-name">${p.name}</div>
        <div class="search-result-brand">${p.brand}</div>
      </div>
      <div class="search-result-price">${p.price} €</div>
    </div>`).join('');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSearch(); closeAuth(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
});

/* ══════════════════════════════
   NAVIGATION
══════════════════════════════ */
function showPage(name, pushState = true) {
  closeMobileMenu();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
  const p = document.getElementById('page-' + name);
  if (p) p.classList.add('active');
  const n = document.getElementById('nav-' + name);
  if (n) n.classList.add('active');
  if (name === 'account') loadOrders();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (pushState) history.pushState({ page: name }, '', '#' + name);
}

window.addEventListener('popstate', e => {
  const name = e.state?.page || 'home';
  showPage(name, false);
});

(function() {
  const valid = ['home','shop','brands','histoire','contact','account','cart','checkout','legal'];
  const hash = location.hash.replace('#', '');
  if (hash && valid.includes(hash)) showPage(hash, false);
  else history.replaceState({ page: 'home' }, '', '#home');
})();

function toggleMobileMenu() {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('mobile-menu-btn');
  const isOpen = nav.classList.contains('open');
  nav.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);
  document.body.style.overflow = isOpen ? '' : 'hidden';
}

function closeMobileMenu() {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('mobile-menu-btn');
  if (!nav) return;
  nav.classList.remove('open');
  btn.classList.remove('open');
  document.body.style.overflow = '';
}

function closeMobileIfOutside(e) {
  if (e.target === document.getElementById('mobile-nav')) closeMobileMenu();
}

function switchTab(btn, tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tabId).classList.add('active');
}

function switchAccTab(name) {}


function selectThumb(el) {
  document.querySelectorAll('.product-thumb').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

function subscribeNewsletter(inputId = 'nl-email') {
  const emailEl = document.getElementById(inputId);
  const e = emailEl?.value.trim();
  if (e && e.includes('@')) {
    const regEmail = document.getElementById('reg-email');
    if (regEmail) regEmail.value = e;
  }
  openAuth('register');
}

let notifTimer;
function notif(msg) {
  const el = document.getElementById('notif');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ══════════════════════════════
   COMMANDES
══════════════════════════════ */
async function saveOrder(paymentIntentId) {
  if (!currentUser || !accessToken) return;
  const address = [
    document.getElementById('co-address')?.value,
    document.getElementById('co-address2')?.value,
    document.getElementById('co-zip')?.value,
    document.getElementById('co-city')?.value
  ].filter(Boolean).join(', ');
  try {
    await sbPost('orders', {
      user_id: currentUser.id,
      customer_name: [document.getElementById('co-firstname')?.value, document.getElementById('co-lastname')?.value].filter(Boolean).join(' '),
      customer_email: document.getElementById('co-email')?.value,
      customer_phone: document.getElementById('co-phone')?.value || null,
      address,
      delivery_type: document.querySelector('input[name="delivery"]:checked')?.value || 'standard',
      delivery_cost: checkoutDeliveryCost,
      items: cart.map(i => ({ id: i.id, name: i.name, brand: i.brand, price: i.price, qty: i.qty })),
      subtotal: cart.reduce((s, i) => s + (i.price * i.qty), 0),
      promo_discount: checkoutPromoDiscount,
      total: calculateCheckoutTotal(),
      stripe_payment_intent_id: paymentIntentId,
      status: 'confirmed'
    }, accessToken);
  } catch (e) {
    console.error('saveOrder:', e);
  }
}

async function sendConfirmationEmail() {
  const address = [
    document.getElementById('co-address')?.value,
    document.getElementById('co-address2')?.value,
    document.getElementById('co-zip')?.value,
    document.getElementById('co-city')?.value
  ].filter(Boolean).join(', ');
  await fetch('/api/send-confirmation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerEmail: document.getElementById('co-email')?.value,
      customerName: [document.getElementById('co-firstname')?.value, document.getElementById('co-lastname')?.value].filter(Boolean).join(' '),
      items: cart.map(i => ({ name: i.name, brand: i.brand, price: i.price, qty: i.qty })),
      total: calculateCheckoutTotal(),
      deliveryType: document.querySelector('input[name="delivery"]:checked')?.value || 'standard',
      address
    })
  });
}

/* ══════════════════════════════
   CONTACT
══════════════════════════════ */
async function sendContactMessage() {
  const name = document.getElementById('contact-name')?.value.trim();
  const email = document.getElementById('contact-email')?.value.trim();
  const message = document.getElementById('contact-message')?.value.trim();

  if (!name || !email || !message) { notif('Veuillez remplir tous les champs'); return; }
  if (!email.includes('@')) { notif('Email invalide'); return; }

  const btn = document.getElementById('contact-btn');
  btn.textContent = 'Envoi en cours...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message })
    });
    if (!res.ok) throw new Error('Erreur serveur');
    notif('Message envoyé — nous vous répondrons sous 24h ✓');
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-email').value = '';
    document.getElementById('contact-message').value = '';
  } catch (e) {
    notif('Erreur lors de l\'envoi — contactez-nous directement par email');
  } finally {
    btn.textContent = 'Envoyer le message';
    btn.disabled = false;
  }
}

/* ══════════════════════════════
   PROFIL
══════════════════════════════ */
async function updateProfile() {
  if (!currentUser || !accessToken) return;
  const firstname = document.getElementById('acc-firstname')?.value.trim();
  const lastname = document.getElementById('acc-lastname')?.value.trim();
  const phone = document.getElementById('acc-phone')?.value.trim();
  const address = document.getElementById('acc-address')?.value.trim();
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: { firstname, lastname, phone, address } })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    currentUser = data;
    notif('Profil mis à jour ✓');
  } catch (e) {
    notif('Erreur : ' + e.message);
  }
}

/* ══════════════════════════════
   DÉMARRAGE
══════════════════════════════ */
loadData();
renderCart();