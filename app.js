const SUPABASE_URL = 'https://vuqukiuxzplvaavctypm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tgw32oQkZeOwmTvTHpEuog_oIQYla2_';
// Comptes qui voient le lien vers l'administration (garder synchronisé avec admin.html)
const ADMIN_EMAILS = ['akfragrance75@gmail.com'];

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
    await handlePaymentReturn();
    handleAuthRedirect();
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
  if (map.showroom_days) {
    document.querySelectorAll('.showroom-days').forEach(el => { el.textContent = map.showroom_days; });
    const lower = map.showroom_days.charAt(0).toLowerCase() + map.showroom_days.slice(1);
    document.querySelectorAll('.showroom-days-lower').forEach(el => { el.textContent = lower; });
  }
  if (map.showroom_hours) {
    document.querySelectorAll('.showroom-hours').forEach(el => { el.textContent = map.showroom_hours; });
  }
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
  const passwordConfirm = document.getElementById('reg-password-confirm').value;
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
  if (password !== passwordConfirm) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Les deux mots de passe ne correspondent pas.';
    document.getElementById('reg-password-confirm').focus();
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
  const isAdmin = !!currentUser && ADMIN_EMAILS.includes((currentUser.email || '').toLowerCase());
  document.querySelectorAll('.admin-only').forEach(el => { el.style.display = isAdmin ? '' : 'none'; });
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

/* ── MOT DE PASSE OUBLIÉ ── */
// Supabase renvoie vers le site avec #access_token=…&type=recovery (ou #error=…) :
// on le lit avant que la navigation ne remplace le hash.
const authRedirect = (() => {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('type') === 'recovery' && h.get('access_token')) {
    return { recovery: { access_token: h.get('access_token'), refresh_token: h.get('refresh_token') } };
  }
  if (h.get('error_code') || h.get('error')) return { error: h.get('error_code') || h.get('error') };
  return null;
})();
let recoverySession = null;

function openForgot() {
  const loginEmail = document.getElementById('login-email')?.value.trim();
  const forgotEmail = document.getElementById('forgot-email');
  if (forgotEmail && loginEmail && !forgotEmail.value) forgotEmail.value = loginEmail;
  openAuth('forgot');
  setTimeout(() => forgotEmail?.focus(), 100);
}

async function doForgot() {
  const email = document.getElementById('forgot-email').value.trim();
  const msg = document.getElementById('forgot-msg');
  const btn = document.getElementById('forgot-btn');
  msg.className = 'auth-msg';
  msg.textContent = '';
  if (!email || !email.includes('@')) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Veuillez saisir un email valide.';
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(location.origin + '/')}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (res.status === 429) throw new Error('Trop de demandes, réessayez dans quelques minutes.');
    if (!res.ok) throw new Error('Envoi impossible pour le moment, réessayez plus tard.');
    // Même message que le compte existe ou non (ne révèle pas quels emails sont inscrits)
    msg.className = 'auth-msg success';
    msg.textContent = 'Si un compte existe avec cet email, un lien vient de vous être envoyé. Pensez à vérifier vos spams.';
  } catch (e) {
    msg.className = 'auth-msg error';
    msg.textContent = e.message;
  }
  btn.disabled = false;
}

function handleAuthRedirect() {
  if (!authRedirect) return;
  if (authRedirect.error) {
    openAuth('forgot');
    const msg = document.getElementById('forgot-msg');
    msg.className = 'auth-msg error';
    msg.textContent = 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.';
    return;
  }
  recoverySession = authRedirect.recovery;
  openAuth('reset');
  setTimeout(() => document.getElementById('reset-password')?.focus(), 100);
}

async function doResetPassword() {
  const password = document.getElementById('reset-password').value;
  const confirm = document.getElementById('reset-password-confirm').value;
  const msg = document.getElementById('reset-msg');
  const btn = document.getElementById('reset-btn');
  msg.className = 'auth-msg error';
  if (password.length < 6) { msg.textContent = 'Le mot de passe doit contenir au moins 6 caractères.'; return; }
  if (password !== confirm) { msg.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
  if (!recoverySession) { msg.textContent = 'Lien invalide. Demandez un nouveau lien.'; return; }
  btn.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + recoverySession.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const user = await res.json();
    if (!res.ok) {
      const m = (user.msg || user.error_description || user.message || '');
      throw new Error(/different from the old/i.test(m) ? 'Le nouveau mot de passe doit être différent de l\'ancien.' : 'Ce lien a expiré. Demandez un nouveau lien.');
    }
    // Le lien connecte aussi l'utilisateur : on garde la session
    localStorage.setItem('ak_session', JSON.stringify({ ...recoverySession, user }));
    currentUser = user;
    accessToken = recoverySession.access_token;
    recoverySession = null;
    updateAccountUI();
    await loadUserData();
    closeAuth();
    notif('Mot de passe modifié — vous êtes connecté(e) ✓');
    showPage('account');
  } catch (e) {
    msg.textContent = e.message;
  }
  btn.disabled = false;
}

/* ── AUTH MODAL ── */
function openAuth(tab = 'login') {
  const tabIndex = { login: 0, register: 1 }[tab];
  switchAuthTab(tab, tabIndex === undefined ? null : document.querySelectorAll('.auth-tab')[tabIndex]);
  document.querySelector('.auth-tabs').style.display = tabIndex === undefined ? 'none' : '';
  ['login-msg', 'register-msg', 'forgot-msg', 'reset-msg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
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
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px">` +
    favorites.map(f => `
    <div style="background:var(--beige-light);cursor:pointer;position:relative" onclick="openFavProduct(${f.productId})">
      <div style="aspect-ratio:3/4;overflow:hidden;position:relative">
        ${f.imageUrl
          ? `<img src="${f.imageUrl}" alt="${f.name}" style="width:100%;height:100%;object-fit:cover" loading="lazy" decoding="async">`
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
  checkoutDeliveryType = 'standard';
  checkoutPromoDiscount = 0;
  checkoutPromoCode = '';
  document.getElementById('co-promo-msg').textContent = '';
  document.getElementById('co-promo-line').style.display = 'none';
  document.getElementById('co-promo').value = '';
  document.querySelectorAll('.delivery-option').forEach((o, i) => {
    o.classList.toggle('selected', i === 0);
    const radio = o.querySelector('input[type=radio]');
    if (radio) radio.checked = i === 0;
  });
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
let checkoutDeliveryType = 'standard';
let checkoutPromoDiscount = 0;
let checkoutPromoCode = '';
let pendingAmountUpdate = Promise.resolve();

function selectDelivery(el, type, cost) {
  if (type === checkoutDeliveryType) return;
  document.querySelectorAll('.delivery-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  checkoutDeliveryType = type;
  checkoutDeliveryCost = cost;
  renderCheckoutSummary();
  updateStripeAmount();
}

function applyCheckoutPromo() {
  const code = document.getElementById('co-promo').value.trim().toUpperCase();
  const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const msg = document.getElementById('co-promo-msg');
  // Simple aperçu : le serveur revérifie le code et recalcule la réduction (api/_pricing.js)
  checkoutPromoCode = (code === 'AK10' || code === 'BIENVENUE') ? code : '';
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
// Clé publique de secours (mode test) si STRIPE_PUBLISHABLE_KEY n'est pas définie sur Vercel
const STRIPE_FALLBACK_KEY = 'pk_test_51Tg6AeGtJjq6z10aakr3XknFkweXR1cDg0sUakztGVqeqJgHYPML823KsGI5nY0I4lVZ483h07eHU2TK9MEO9s6B00dDsZ3Inv';

async function getStripe() {
  if (stripeInstance) return stripeInstance;
  let key = STRIPE_FALLBACK_KEY;
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.stripePublishableKey) key = cfg.stripePublishableKey;
  } catch (e) {}
  stripeInstance = Stripe(key);
  return stripeInstance;
}

// Ce que le serveur utilise pour recalculer le montant (il relit les prix dans Supabase)
function checkoutPricingPayload() {
  return {
    items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    deliveryType: checkoutDeliveryType,
    promoCode: checkoutPromoCode
  };
}

// Le montant affiché suit celui calculé par le serveur, qui est celui réellement débité
function applyServerOrder(order) {
  if (!order || typeof order.total !== 'number') return;
  checkoutDeliveryCost = order.deliveryCost;
  checkoutPromoDiscount = order.discount;
  renderCheckoutSummary();
}

async function initPaymentForm() {
  const el = document.getElementById('stripe-payment-element');
  if (!el) return;

  el.innerHTML = '<div style="padding:20px;text-align:center;font-size:10px;letter-spacing:2px;color:var(--text-muted);text-transform:uppercase">Chargement du formulaire...</div>';

  try {
    await getStripe();
    const sent = checkoutPricingPayload();
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...sent,
        customerEmail: document.getElementById('co-email')?.value || '',
        customerName: [document.getElementById('co-firstname')?.value, document.getElementById('co-lastname')?.value].filter(Boolean).join(' ')
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Paiement indisponible');
    const { clientSecret, paymentIntentId } = data;

    currentClientSecret = clientSecret;
    currentPaymentIntentId = paymentIntentId;
    applyServerOrder(data);
    // Livraison ou code promo changés pendant la création du paiement
    if (sent.deliveryType !== checkoutDeliveryType || sent.promoCode !== checkoutPromoCode) updateStripeAmount();

    const appearance = {
      theme: 'stripe',
      variables: {
        colorPrimary: '#3B2A1C',
        colorBackground: '#FAF5EC',
        colorText: '#2E2015',
        colorTextSecondary: '#6B5644',
        colorDanger: '#9A3A3A',
        fontFamily: '"Jost", sans-serif',
        borderRadius: '0px',
        spacingUnit: '5px',
        fontSizeBase: '13px'
      },
      rules: {
        '.Input': { border: '1px solid rgba(59,42,28,0.18)', boxShadow: 'none', padding: '12px 14px' },
        '.Input:focus': { border: '1px solid #B39062', boxShadow: 'none' },
        '.Label': { fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', color: '#A3845A' }
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

function updateStripeAmount() {
  if (!currentPaymentIntentId) return;
  pendingAmountUpdate = pendingAmountUpdate.then(async () => {
    try {
      const res = await fetch('/api/update-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId: currentPaymentIntentId, ...checkoutPricingPayload() })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Erreur de mise à jour du montant');
      applyServerOrder(data);
      if (stripeElements) await stripeElements.fetchUpdates();
    } catch (e) {
      console.error('updateStripeAmount:', e);
      notif(e.message);
    }
  });
  return pendingAmountUpdate;
}

/* ── Commande en attente : permet de l'enregistrer même si la banque,
   PayPal ou Klarna redirigent le client hors du site pendant le paiement ── */
function collectCheckoutData() {
  const val = id => document.getElementById(id)?.value.trim() || '';
  const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  return {
    customerName: [val('co-firstname'), val('co-lastname')].filter(Boolean).join(' '),
    customerEmail: val('co-email'),
    customerPhone: val('co-phone'),
    address: [val('co-address'), val('co-address2'), val('co-zip'), val('co-city')].filter(Boolean).join(', '),
    deliveryType: checkoutDeliveryType,
    deliveryCost: checkoutDeliveryCost,
    items: cart.map(i => ({ id: i.id, dbId: i.dbId, name: i.name, brand: i.brand, price: i.price, qty: i.qty })),
    subtotal: sub,
    promoDiscount: checkoutPromoDiscount,
    total: calculateCheckoutTotal()
  };
}

async function finalizeOrder(paymentIntentId, data) {
  await saveOrder(paymentIntentId, data);
  sendConfirmationEmail(data).catch(e => console.error('email:', e));

  if (currentUser && accessToken) {
    for (const item of data.items) {
      if (item.dbId) try { await sbDelete('cart_items?id=eq.' + item.dbId, accessToken); } catch (e) {}
    }
  }
  try { localStorage.removeItem('ak_pending_order'); } catch (e) {}
  cart = [];
  updateCartBadge();
  renderCart();
  showPage('confirmation');
}

// Retour sur le site après une redirection de paiement (3D Secure, PayPal, Klarna…)
async function handlePaymentReturn() {
  const params = new URLSearchParams(location.search);
  const clientSecret = params.get('payment_intent_client_secret');
  if (!clientSecret) return;
  history.replaceState({ page: 'home' }, '', location.pathname + '#home');

  let pending = null;
  try { pending = JSON.parse(localStorage.getItem('ak_pending_order') || 'null'); } catch (e) {}

  try {
    const stripe = await getStripe();
    const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      if (pending && pending.paymentIntentId === paymentIntent.id) {
        await finalizeOrder(paymentIntent.id, pending.data);
      } else {
        showPage('confirmation');
      }
    } else {
      notif('Le paiement n\'a pas abouti — aucun montant n\'a été débité');
      showPage('cart');
    }
  } catch (e) {
    console.error('handlePaymentReturn:', e);
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
    // Attendre qu'un éventuel changement de livraison / code promo soit pris en compte
    await pendingAmountUpdate;
    const data = collectCheckoutData();
    try {
      localStorage.setItem('ak_pending_order', JSON.stringify({ paymentIntentId: currentPaymentIntentId, data }));
    } catch (e) {}

    const { error, paymentIntent } = await stripeInstance.confirmPayment({
      elements: stripeElements,
      confirmParams: { return_url: window.location.origin + '/' },
      redirect: 'if_required'
    });

    if (error) {
      errEl.textContent = error.message;
      btn.innerHTML = `Confirmer et payer — <span id="co-total-btn">${data.total} €</span>`;
      btn.disabled = false;
      return;
    }

    if (paymentIntent && paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
      errEl.textContent = 'Le paiement n\'a pas abouti. Veuillez réessayer.';
      btn.innerHTML = `Confirmer et payer — <span id="co-total-btn">${data.total} €</span>`;
      btn.disabled = false;
      return;
    }

    await finalizeOrder(currentPaymentIntentId, data);

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
    ? `<img class="product-img-photo" src="${mainImg}" alt="${p.name}" loading="lazy" decoding="async" onload="this.classList.add('loaded')">`
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
      `<div class="brand-card" data-brand="${escAttr(b.name)}" onclick="openBrand(this.dataset.brand)"><div class="brand-name">${b.name}</div><div class="brand-desc">${b.description}</div></div>`
    ).join('');
  }

  const hp = document.getElementById('home-products');
  if (hp) hp.innerHTML = products.slice(0, 8).map(productCardHTML).join('');

  const np = document.getElementById('new-products');
  if (np) np.innerHTML = products.filter(p => p.is_new || p.badge === 'new').map(productCardHTML).join('');

  const bf = document.getElementById('brands-full');
  if (bf) bf.innerHTML = allBrands.map(b =>
    `<div class="brand-card" data-brand="${escAttr(b.name)}" onclick="openBrand(this.dataset.brand)"><div class="brand-name">${b.name}</div><div class="brand-desc">${b.description}</div></div>`
  ).join('');

  const bfilt = document.getElementById('brand-filters');
  if (bfilt) {
    // Garde la sélection quand le catalogue est rafraîchi en temps réel
    const checked = new Set([...bfilt.querySelectorAll('input:checked')].map(cb => cb.value));
    bfilt.innerHTML = allBrands.map(b =>
      `<label class="filter-check"><input type="checkbox" value="${escAttr(b.name)}"${checked.has(b.name) ? ' checked' : ''} onchange="filterShop()"><span>${b.name}</span></label>`
    ).join('');
  }

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

  const showInStock = document.getElementById('filter-instock')?.checked ?? true;
  const showOut = document.getElementById('filter-out')?.checked ?? true;

  let list = products.filter(p => {
    const ms = !q || (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q) || (p.notes_top || []).join(' ').toLowerCase().includes(q);
    const mb = checkedBrands.length === 0 || checkedBrands.includes((p.brand || '').toLowerCase());
    const mn = checkedNotes.length === 0 || checkedNotes.some(n => (p.notes_top||[]).includes(n) || (p.notes_heart||[]).includes(n) || (p.notes_base||[]).includes(n));
    const isOut = p.badge === 'out';
    const ma = (isOut && showOut) || (!isOut && showInStock) || (!showOut && !showInStock);
    return ms && mb && mn && ma && (Number(p.price) || 0) <= maxP;
  });
  if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (sort === 'new') list = [...list.filter(p => p.is_new || p.badge === 'new'), ...list.filter(p => !p.is_new && p.badge !== 'new')];
  const el = document.getElementById('shop-products');
  if (el) el.innerHTML = list.length ? list.map(productCardHTML).join('') : '<div class="no-results">Aucun produit trouvé</div>';
  updateShopHeader(list.length, checkedBrands.length + checkedNotes.length + (showInStock && showOut ? 0 : 1) + (maxP < (Number(document.querySelector('.price-range')?.max) || maxP) ? 1 : 0));
}

function escAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Titre « La Boutique » ou nom de la maison, compteur et pastille des filtres actifs
function updateShopHeader(count, activeFilters) {
  const brands = [...document.querySelectorAll('#brand-filters input:checked')].map(cb => cb.value);
  const title = document.getElementById('shop-title');
  const allLink = document.getElementById('shop-all-link');
  if (title) title.textContent = brands.length === 1 ? brands[0] : 'La Boutique';
  if (allLink) allLink.style.display = brands.length ? '' : 'none';
  const countEl = document.getElementById('filters-count');
  if (countEl) countEl.textContent = count;
  const badge = document.getElementById('filters-badge');
  if (badge) badge.textContent = activeFilters ? activeFilters : '';
}

// Clic sur une maison : boutique filtrée sur cette maison
function openBrand(name) {
  resetFilters(false);
  document.querySelectorAll('#brand-filters input[type=checkbox]').forEach(cb => {
    cb.checked = cb.value.toLowerCase() === (name || '').toLowerCase();
  });
  filterShop();
  showPage('shop');
}

function resetFilters(refresh = true) {
  document.querySelectorAll('#shop-filters input[type=checkbox]').forEach(cb => {
    cb.checked = cb.id === 'filter-instock' || cb.id === 'filter-out';
  });
  const slider = document.querySelector('.price-range');
  if (slider) {
    slider.value = slider.max;
    const pmax = document.getElementById('pmax');
    if (pmax) pmax.textContent = slider.max + '€';
  }
  const search = document.getElementById('shop-search-input');
  if (search) search.value = '';
  if (refresh) filterShop();
}

/* ── Filtres en panneau latéral sur mobile ── */
function openFilters() {
  document.getElementById('page-shop')?.classList.add('filters-open');
  document.body.style.overflow = 'hidden';
}
function closeFilters() {
  document.getElementById('page-shop')?.classList.remove('filters-open');
  document.body.style.overflow = '';
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
    mainImg.innerHTML = `<img src="${allImgs[0]}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover" decoding="async">`;
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
          <img src="${url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover" loading="lazy" decoding="async">
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
  const hasNotes = (p.notes_top||[]).length || (p.notes_heart||[]).length || (p.notes_base||[]).length;
  const notesSection = document.querySelector('.notes-section');
  if (notesSection) notesSection.style.display = hasNotes ? '' : 'none';

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
        ? `<img class="search-result-swatch" src="${p.image_url}" alt="${p.name}" style="object-fit:cover" loading="lazy" decoding="async">`
        : `<div class="search-result-swatch" style="background:${swatchBgs[p.img] || swatchBgs.p1}"></div>`}
      <div>
        <div class="search-result-name">${p.name}</div>
        <div class="search-result-brand">${p.brand}</div>
      </div>
      <div class="search-result-price">${p.price} €</div>
    </div>`).join('');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSearch(); closeAuth(); closeFilters(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
});

/* ══════════════════════════════
   NAVIGATION
══════════════════════════════ */
function showPage(name, pushState = true) {
  closeMobileMenu();
  document.getElementById('page-shop')?.classList.remove('filters-open');
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
  // Lien « Mot de passe oublié » depuis l'admin
  if (hash === 'forgot') openForgot();
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
async function saveOrder(paymentIntentId, data) {
  if (!currentUser || !accessToken) return;
  try {
    await sbPost('orders', {
      user_id: currentUser.id,
      customer_name: data.customerName,
      customer_email: data.customerEmail,
      customer_phone: data.customerPhone || null,
      address: data.address,
      delivery_type: data.deliveryType,
      delivery_cost: data.deliveryCost,
      items: data.items.map(i => ({ id: i.id, name: i.name, brand: i.brand, price: i.price, qty: i.qty })),
      subtotal: data.subtotal,
      promo_discount: data.promoDiscount,
      total: data.total,
      stripe_payment_intent_id: paymentIntentId,
      status: 'confirmed'
    }, accessToken);
  } catch (e) {
    console.error('saveOrder:', e);
  }
}

async function sendConfirmationEmail(data) {
  await fetch('/api/send-confirmation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      customerPhone: data.customerPhone || '',
      items: data.items.map(i => ({ name: i.name, brand: i.brand, price: i.price, qty: i.qty })),
      total: data.total,
      deliveryType: data.deliveryType,
      deliveryCost: data.deliveryCost,
      address: data.address
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

function bookShowroom() {
  showPage('contact');
  const msg = document.getElementById('contact-message');
  if (msg && !msg.value.trim()) {
    msg.value = 'Bonjour, je souhaite prendre rendez-vous au showroom. Mes disponibilités : ';
  }
  setTimeout(() => {
    const target = document.getElementById(document.getElementById('contact-name')?.value ? 'contact-message' : 'contact-name');
    target?.focus({ preventScroll: true });
  }, 400);
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