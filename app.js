const SUPABASE_URL = 'https://vuqukiuxzplvaavctypm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tgw32oQkZeOwmTvTHpEuog_oIQYla2_';
const STRIPE_PK = 'pk_test_51Tg6AeGtJjq6z10aakr3XknFkweXR1cDg0sUakztGVqeqJgHYPML823KsGI5nY0I4lVZ483h07eHU2TK9MEO9s6B00dDsZ3Inv';
let stripeInstance = null;
let stripeElements = null;
let stripePaymentElement = null;

let products = [];
let allBrands = [];
let cart = [];
let favorites = [];
let currentUser = null;
let accessToken = null;

/* ── SUPABASE HELPERS ── */
async function sbGet(path, token=null){
  const headers = {'apikey':SUPABASE_KEY,'Authorization':'Bearer '+(token||SUPABASE_KEY)};
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {headers});
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}
async function sbPost(path, body, token){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    method:'POST',headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+token,'Content-Type':'application/json','Prefer':'return=representation'},
    body:JSON.stringify(body)
  });
  if(!res.ok) throw new Error(await res.text());
  const t=await res.text(); return t?JSON.parse(t):[];
}
async function sbPatch(path, body, token){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    method:'PATCH',headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+token,'Content-Type':'application/json','Prefer':'return=representation'},
    body:JSON.stringify(body)
  });
  if(!res.ok) throw new Error(await res.text());
  const t=await res.text(); return t?JSON.parse(t):[];
}
async function sbDelete(path, token){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    method:'DELETE',headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+token}
  });
  if(!res.ok) throw new Error(await res.text());
}
async function sbAuth(endpoint, body){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`,{
    method:'POST',headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error_description||data.msg||'Erreur');
  return data;
}

/* ── INIT ── */
async function loadData(){
  try {
    [products, allBrands] = await Promise.all([sbGet('products?order=id'), sbGet('brands?order=name')]);
    renderAll();
    await checkSession();
    connectRealtime();
  } catch(e){ notif('Erreur de chargement'); console.error(e); }
  finally { document.getElementById('loading').classList.add('hidden'); }
}

async function checkSession(){
  const session = JSON.parse(localStorage.getItem('ak_session')||'null');
  if(!session || !session.access_token) return;

  // Check if token is expired (JWT exp claim)
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    const isExpired = payload.exp * 1000 < Date.now();

    if(isExpired && session.refresh_token){
      // Refresh the token
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {'apikey': SUPABASE_KEY, 'Content-Type': 'application/json'},
        body: JSON.stringify({refresh_token: session.refresh_token})
      });
      if(res.ok){
        const newSession = await res.json();
        localStorage.setItem('ak_session', JSON.stringify(newSession));
        currentUser = newSession.user;
        accessToken = newSession.access_token;
      } else {
        // Refresh failed, clear session
        localStorage.removeItem('ak_session');
        return;
      }
    } else if(isExpired) {
      localStorage.removeItem('ak_session');
      return;
    } else {
      currentUser = session.user;
      accessToken = session.access_token;
    }
  } catch(e) {
    currentUser = session.user;
    accessToken = session.access_token;
  }

  updateAccountUI();
  await loadUserData();
}

/* ── CHARGER DONNÉES UTILISATEUR ── */
async function loadUserData(){
  if(!currentUser || !accessToken) return;
  try {
    const [cartItems, favItems] = await Promise.all([
      sbGet(`cart_items?user_id=eq.${currentUser.id}&order=created_at`, accessToken),
      sbGet(`favorites?user_id=eq.${currentUser.id}&order=created_at`, accessToken)
    ]);
    // Restore cart
    cart = cartItems.map(i => ({
      dbId: i.id,
      id: i.product_id || i.id,
      name: i.name, brand: i.brand, price: i.price,
      img: i.img||'p1', imageUrl: i.image_url||'', qty: i.qty
    }));
    // Restore favorites
    favorites = favItems.map(i => ({
      dbId: i.id,
      productId: i.product_id,
      name: i.name, price: i.price,
      img: i.img||'p1', imageUrl: i.image_url||''
    }));
    updateCartBadge();
    renderCart();
    renderFavorites();
  } catch(e){ console.error('loadUserData:', e); }
}

/* ── AUTH ── */
async function doLogin(){
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('login-msg');
  msg.className='auth-msg'; msg.textContent='';
  if(!email||!password){ msg.className='auth-msg error'; msg.textContent='Veuillez remplir tous les champs.'; return; }
  try {
    const data = await sbAuth('token?grant_type=password', {email, password});
    localStorage.setItem('ak_session', JSON.stringify(data));
    currentUser = data.user;
    accessToken = data.access_token;
    updateAccountUI();
    await loadUserData();
    closeAuth();
    const firstname = currentUser.user_metadata?.firstname || email.split('@')[0];
    notif(`Bienvenue ${firstname} ! ✓`);
    showPage('account');
  } catch(e){
    msg.className='auth-msg error';
    msg.textContent = e.message.includes('Invalid') ? 'Email ou mot de passe incorrect.' : e.message;
  }
}

async function doRegister(){
  const firstname = document.getElementById('reg-firstname').value.trim();
  const lastname = document.getElementById('reg-lastname').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const msg = document.getElementById('register-msg');
  msg.className='auth-msg'; msg.textContent='';
  if(!firstname||!lastname||!email||!password){ msg.className='auth-msg error'; msg.textContent='Veuillez remplir tous les champs obligatoires.'; return; }
  if(password.length<6){ msg.className='auth-msg error'; msg.textContent='Le mot de passe doit contenir au moins 6 caractères.'; return; }
  try {
    const data = await sbAuth('signup', {email, password, data:{firstname,lastname,phone}});
    localStorage.setItem('ak_session', JSON.stringify(data));
    currentUser = data.user;
    accessToken = data.access_token;
    updateAccountUI();
    closeAuth();
    notif(`Bienvenue ${firstname} ! Votre compte a été créé ✓`);
    showPage('account');
  } catch(e){
    msg.className='auth-msg error';
    msg.textContent = e.message.includes('already') ? 'Un compte existe déjà avec cet email.' : e.message;
  }
}

async function doLogout(){
  // Clear remote data reference locally only (data stays in DB)
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

function updateAccountUI(){
  const btn = document.getElementById('account-btn');
  const connected = document.getElementById('account-connected');
  const disconnected = document.getElementById('account-disconnected');
  if(currentUser){
    btn.style.background='rgba(90,70,53,0.12)';
    btn.querySelector('svg').style.stroke='var(--brown-dark)';
    const email = currentUser.email||'';
    const firstname = currentUser.user_metadata?.firstname||'';
    const lastname = currentUser.user_metadata?.lastname||'';
    const name = [firstname,lastname].filter(Boolean).join(' ')||email.split('@')[0];
    if(document.getElementById('account-email-display')) document.getElementById('account-email-display').textContent=email;
    if(document.getElementById('account-name-display')) document.getElementById('account-name-display').textContent=name;
    if(connected) connected.style.display='block';
    if(disconnected) disconnected.style.display='none';
  } else {
    btn.style.background='';
    btn.querySelector('svg').style.stroke='';
    if(connected) connected.style.display='none';
    if(disconnected) disconnected.style.display='block';
  }
}

function handleAccountClick(){ if(currentUser){showPage('account');}else{openAuth('login');} }
function handleFavClick(){ if(currentUser){showPage('account');}else{openAuth('login');} }

/* ── AUTH MODAL ── */
function openAuth(tab='login'){
  switchAuthTab(tab, document.querySelectorAll('.auth-tab')[tab==='login'?0:1]);
  document.getElementById('login-msg').textContent='';
  document.getElementById('register-msg').textContent='';
  document.getElementById('auth-overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeAuth(){ document.getElementById('auth-overlay').classList.remove('open'); document.body.style.overflow=''; }
function closeAuthIfOutside(e){ if(e.target===document.getElementById('auth-overlay')) closeAuth(); }
function switchAuthTab(name,btn){
  document.querySelectorAll('.auth-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.getElementById('auth-'+name).classList.add('active');
}

/* ── FAVORIS ── */
async function quickAddFav(name, price, productId, img, imageUrl){
  if(!currentUser){ openAuth('login'); notif('Connectez-vous pour ajouter aux favoris'); return; }
  if(favorites.find(f=>f.productId===productId)) { notif('Déjà dans vos favoris'); return; }
  try {
    const res = await sbPost('favorites', {
      user_id: currentUser.id, product_id: productId,
      name, price, img: img||'p1', image_url: imageUrl||null
    }, accessToken);
    favorites.push({dbId:res[0]?.id, productId, name, price, img:img||'p1', imageUrl:imageUrl||''});
    renderFavorites();
    notif('Ajouté aux favoris ♡');
  } catch(e){ notif('Erreur favoris : '+e.message); }
}

async function addToWish(){
  const name = document.getElementById('prod-name').textContent;
  const price = parseInt(document.getElementById('prod-price').textContent);
  const imgEl = document.getElementById('prod-main-img').querySelector('img');
  const p = products.find(x=>x.name===name);
  await quickAddFav(name, price, p?.id, p?.img, imgEl?.src||'');
}

async function removeFav(dbId){
  try {
    await sbDelete(`favorites?id=eq.${dbId}`, accessToken);
    favorites = favorites.filter(f=>f.dbId!==dbId);
    renderFavorites();
  } catch(e){ notif('Erreur : '+e.message); }
}

function renderFavorites(){
  const el = document.getElementById('fav-list'); if(!el) return;
  if(!favorites.length){ el.innerHTML='<p style="font-size:13px;color:var(--text-muted)">Aucun favori pour le moment.</p>'; return; }
  el.innerHTML = favorites.map(f=>`
    <div class="fav-row">
      <div style="display:flex;align-items:center;gap:12px">
        ${f.imageUrl?`<img src="${f.imageUrl}" style="width:40px;height:52px;object-fit:cover;border-radius:2px">`:`<div style="width:40px;height:52px;border-radius:2px;background:${swatchBgs[f.img]||swatchBgs.p1}"></div>`}
        <div><div class="fav-name">${f.name}</div><div class="fav-price">${f.price} €</div></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-secondary" style="padding:8px 16px;font-size:9px" onclick="addToCartDirect('${f.name}','',${f.price},${f.productId},'${f.img}','${f.imageUrl}')">Ajouter au panier</button>
        <button style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-muted);transition:color .2s" onmouseover="this.style.color='var(--brown-dark)'" onmouseout="this.style.color='var(--text-muted)'" onclick="removeFav(${f.dbId})">✕</button>
      </div>
    </div>`).join('');
}

/* ── PANIER ── */
async function addToCartDirect(name, brand, price, productId, img, imageUrl){
  const existing = cart.find(i=>i.id===productId);
  if(existing){
    existing.qty++;
    if(currentUser && existing.dbId){
      try { await sbPatch(`cart_items?id=eq.${existing.dbId}`,{qty:existing.qty},accessToken); } catch(e){}
    }
  } else {
    const item = {id:productId||Date.now(), name, brand, price, img:img||'p1', imageUrl:imageUrl||'', qty:1};
    if(currentUser){
      try {
        const res = await sbPost('cart_items',{
          user_id:currentUser.id, product_id:productId||null,
          name, brand, price, img:img||'p1', image_url:imageUrl||null, qty:1
        }, accessToken);
        item.dbId = res[0]?.id;
      } catch(e){ console.error(e); }
    }
    cart.push(item);
  }
  updateCartBadge();
  notif('Ajouté au panier — '+name);
  renderCart();
}

async function addToCartProduct(){
  const name=document.getElementById('prod-name').textContent;
  const brand=document.getElementById('prod-brand').textContent;
  const price=parseInt(document.getElementById('prod-price').textContent);
  const imgEl=document.getElementById('prod-main-img').querySelector('img');
  const p=products.find(x=>x.name===name);
  await addToCartDirect(name,brand,price,p?.id,p?.img,imgEl?.src||'');
}

async function removeFromCart(idx){
  const item = cart[idx];
  if(currentUser && item.dbId){
    try { await sbDelete(`cart_items?id=eq.${item.dbId}`,accessToken); } catch(e){}
  }
  cart.splice(idx,1);
  renderCart(); updateCartBadge();
}

async function changeQty(idx, delta){
  cart[idx].qty += delta;
  if(cart[idx].qty<=0){ removeFromCart(idx); return; }
  if(currentUser && cart[idx].dbId){
    try { await sbPatch(`cart_items?id=eq.${cart[idx].dbId}`,{qty:cart[idx].qty},accessToken); } catch(e){}
  }
  renderCart(); updateCartBadge();
}

function updateCartBadge(){ document.getElementById('cart-count').textContent=cart.reduce((s,i)=>s+i.qty,0); }

function renderCart(){
  const list=document.getElementById('cart-list');
  if(cart.length===0){
    list.innerHTML='<p style="font-size:13px;color:var(--text-muted);padding:40px 0">Votre panier est vide.</p>';
    ['cart-subtotal','cart-total'].forEach(id=>document.getElementById(id).textContent='0 €');
    document.getElementById('cart-livraison').textContent='—';
    document.getElementById('livraison-note').textContent='';
    return;
  }
  list.innerHTML=cart.map((item,idx)=>`
    <div class="cart-item">
      ${item.imageUrl?`<img class="cart-item-img" src="${item.imageUrl}" alt="${item.name}">`:`<div class="cart-item-img" style="background:${swatchBgs[item.img]||swatchBgs.p1}"></div>`}
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
        <div style="font-size:18px;font-weight:300;color:var(--brown-dark)">${item.price*item.qty} €</div>
        <button class="remove-item" onclick="removeFromCart(${idx})">✕</button>
      </div>
    </div>`).join('');
  const sub=cart.reduce((s,i)=>s+(i.price*i.qty),0);
  const liv=sub>=150?0:9.9;
  document.getElementById('cart-subtotal').textContent=sub+' €';
  document.getElementById('cart-livraison').textContent=liv===0?'Offerte':liv.toFixed(2)+' €';
  document.getElementById('cart-total').textContent=(sub+liv).toFixed(0)+' €';
  document.getElementById('livraison-note').textContent=sub>0&&sub<150?`Plus que ${150-sub}€ pour la livraison offerte`:sub>=150?'✓ Livraison offerte appliquée':'';
}

function applyPromo(){
  const c=document.getElementById('promo-input').value.trim().toUpperCase();
  if(c==='AK10'){document.getElementById('cart-promo-val').textContent='-10%';notif('Code AK10 appliqué');}
  else if(c==='BIENVENUE'){document.getElementById('cart-promo-val').textContent='-15€';notif('Code BIENVENUE appliqué');}
  else{notif('Code invalide');}
}

function checkout(){
  if(!currentUser){ openAuth('login'); notif('Connectez-vous pour passer commande'); return; }
  if(cart.length===0){notif('Votre panier est vide');return;}
  openCheckout();
}

function openCheckout(){
  // Pre-fill user info
  if(currentUser){
    const m = currentUser.user_metadata||{};
    const fn = document.getElementById('co-firstname'); if(fn) fn.value = m.firstname||'';
    const ln = document.getElementById('co-lastname'); if(ln) ln.value = m.lastname||'';
    const em = document.getElementById('co-email'); if(em) em.value = currentUser.email||'';
    const ph = document.getElementById('co-phone'); if(ph) ph.value = m.phone||'';
    const cn = document.getElementById('co-cardname'); if(cn) cn.value = [m.firstname,m.lastname].filter(Boolean).join(' ').toUpperCase();
  }
  checkoutDeliveryCost = 0;
  checkoutPromoDiscount = 0;
  document.getElementById('co-promo-msg').textContent='';
  document.getElementById('co-promo-line').style.display='none';
  document.getElementById('co-promo').value='';
  // Reset delivery selection
  document.querySelectorAll('.delivery-option').forEach((o,i)=>o.classList.toggle('selected',i===0));
  renderCheckoutSummary();
  showPage('checkout');
  setTimeout(initStripe, 300);
}

let checkoutDeliveryCost = 0;
let checkoutPromoDiscount = 0;

function selectDelivery(el, type, cost){
  document.querySelectorAll('.delivery-option').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);
  checkoutDeliveryCost = sub>=150 && cost===0 ? 0 : cost;
  renderCheckoutSummary();
}

function applyCheckoutPromo(){
  const code = document.getElementById('co-promo').value.trim().toUpperCase();
  const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);
  const msg = document.getElementById('co-promo-msg');
  if(code==='AK10'){
    checkoutPromoDiscount = Math.round(sub*0.10);
    msg.style.color='var(--brown)'; msg.textContent='✓ Code AK10 appliqué — 10% de réduction';
    document.getElementById('co-promo-line').style.display='flex';
  } else if(code==='BIENVENUE'){
    checkoutPromoDiscount = 15;
    msg.style.color='var(--brown)'; msg.textContent='✓ Code BIENVENUE appliqué — 15€ de réduction';
    document.getElementById('co-promo-line').style.display='flex';
  } else {
    checkoutPromoDiscount=0; msg.style.color='#9A3A3A'; msg.textContent='Code invalide';
    document.getElementById('co-promo-line').style.display='none';
  }
  renderCheckoutSummary();
}

function renderCheckoutSummary(){
  const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);
  const total = Math.max(0, sub + checkoutDeliveryCost - checkoutPromoDiscount);
  document.getElementById('co-subtotal').textContent = sub+' €';
  document.getElementById('co-delivery-line').textContent = checkoutDeliveryCost===0?'Offerte':checkoutDeliveryCost.toFixed(2)+' €';
  document.getElementById('co-promo-amount').textContent = '-'+checkoutPromoDiscount+' €';
  document.getElementById('co-total').textContent = total+' €';
  document.getElementById('co-total-btn').textContent = total+' €';
  const items = document.getElementById('checkout-items');
  if(items) items.innerHTML = cart.map(item=>`
    <div class="checkout-item">
      ${item.imageUrl?`<img class="checkout-item-img" src="${item.imageUrl}" alt="${item.name}">`:`<div class="checkout-item-img" style="background:${swatchBgs[item.img]||swatchBgs.p1}"></div>`}
      <div style="flex:1">
        <div class="checkout-item-name">${item.name}</div>
        <div class="checkout-item-brand">${item.brand}</div>
        <div class="checkout-item-qty">Qté : ${item.qty}</div>
      </div>
      <div class="checkout-item-price">${item.price*item.qty} €</div>
    </div>`).join('');
}

function formatCard(input){
  let v = input.value.replace(/\D/g,'').substring(0,16);
  input.value = v.replace(/(.{4})/g,'$1 ').trim();
  const icon = document.getElementById('card-type-icon');
  if(v.startsWith('4')) icon.textContent='Visa';
  else if(v.startsWith('5')) icon.textContent='MC';
  else if(v.startsWith('3')) icon.textContent='Amex';
  else icon.textContent='💳';
}

function formatExpiry(input){
  let v = input.value.replace(/\D/g,'').substring(0,4);
  if(v.length>=2) v = v.substring(0,2)+' / '+v.substring(2);
  input.value = v;
}

async function initStripe(){
  if(!stripeInstance){
    stripeInstance = Stripe(STRIPE_PK);
  }
  const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);
  const total = Math.max(0, sub + checkoutDeliveryCost - checkoutPromoDiscount);
  if(total <= 0) return;
  try {
    // Create PaymentIntent via Netlify function
    const res = await fetch('/.netlify/functions/create-payment-intent', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        amount: total,
        currency: 'eur',
        customerEmail: document.getElementById('co-email')?.value || currentUser?.email || '',
        customerName: [document.getElementById('co-firstname')?.value, document.getElementById('co-lastname')?.value].filter(Boolean).join(' '),
        items: cart.map(i=>({name:i.name, qty:i.qty, price:i.price}))
      })
    });
    const data = await res.json();
    if(!res.ok || !data.clientSecret) throw new Error(data.error || 'Erreur serveur');
    // Mount Stripe Elements
    stripeElements = stripeInstance.elements({
      clientSecret: data.clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#5A4635',
          colorBackground: '#FDFAF5',
          colorText: '#4A3828',
          colorDanger: '#9A3A3A',
          fontFamily: 'Jost, sans-serif',
          borderRadius: '0px',
          fontSizeBase: '13px'
        }
      }
    });
    stripePaymentElement = stripeElements.create('payment');
    stripePaymentElement.mount('#stripe-payment-element');
  } catch(e){
    document.getElementById('stripe-payment-element').innerHTML =
      '<div style="padding:16px;color:#9A3A3A;font-size:12px;border:1px solid rgba(154,58,58,0.2);background:#F8E8E8">Erreur de connexion au service de paiement. Vérifiez votre connexion.</div>';
    console.error('Stripe init error:', e);
  }
}

async function placeOrder(){
  const required = ['co-firstname','co-lastname','co-email','co-address','co-zip','co-city'];
  for(const id of required){
    if(!document.getElementById(id)?.value.trim()){
      notif('Veuillez remplir tous les champs obligatoires');
      document.getElementById(id)?.scrollIntoView({behavior:'smooth', block:'center'});
      document.getElementById(id)?.focus();
      return;
    }
  }
  if(!stripeElements){ notif('Formulaire de paiement non chargé'); return; }
  const btn = document.querySelector('#page-checkout .add-cart-big');
  btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px"></span>Traitement en cours...';
  btn.disabled = true;
  document.getElementById('stripe-error').textContent = '';
  try {
    const returnUrl = window.location.origin + window.location.pathname + '?order=success';
    const { error } = await stripeInstance.confirmPayment({
      elements: stripeElements,
      confirmParams: {
        return_url: returnUrl,
        payment_method_data: {
          billing_details: {
            name: [document.getElementById('co-firstname').value, document.getElementById('co-lastname').value].join(' '),
            email: document.getElementById('co-email').value,
            phone: document.getElementById('co-phone')?.value || '',
            address: {
              line1: document.getElementById('co-address').value,
              line2: document.getElementById('co-address2')?.value || '',
              postal_code: document.getElementById('co-zip').value,
              city: document.getElementById('co-city').value,
              country: document.getElementById('co-country')?.value || 'FR'
            }
          }
        }
      },
      redirect: 'if_required'
    });
    if(error){
      document.getElementById('stripe-error').textContent = error.message;
      btn.innerHTML = 'Confirmer et payer — <span id="co-total-btn">'+document.getElementById('co-total').textContent+'</span>';
      btn.disabled = false;
    } else {
      // Payment succeeded — send confirmation email
      const firstname = document.getElementById('co-firstname').value;
      const lastname = document.getElementById('co-lastname').value;
      const email = document.getElementById('co-email').value;
      const sub = cart.reduce((s,i)=>s+(i.price*i.qty),0);
      const total = Math.max(0, sub + checkoutDeliveryCost - checkoutPromoDiscount);
      const deliveryType = document.querySelector('input[name="delivery"]:checked')?.value || 'standard';
      const address = [
        document.getElementById('co-address').value,
        document.getElementById('co-address2')?.value,
        document.getElementById('co-zip').value + ' ' + document.getElementById('co-city').value,
        document.getElementById('co-country')?.options[document.getElementById('co-country').selectedIndex]?.text
      ].filter(Boolean).join('<br>');

      try {
        await fetch('/.netlify/functions/send-confirmation', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            customerEmail: email,
            customerName: firstname + ' ' + lastname,
            items: cart.map(i=>({name:i.name, qty:i.qty, price:i.price})),
            total: total,
            deliveryType: deliveryType,
            address: address
          })
        });
      } catch(e){ console.error('Email error:', e); }

      if(currentUser && accessToken){
        try { for(const item of cart){ if(item.dbId) await sbDelete('cart_items?id=eq.'+item.dbId, accessToken); } } catch(e){}
      }
      cart = [];
      updateCartBadge();
      renderCart();
      showPage('home');
      notif('✓ Paiement confirmé ! Un email de confirmation vous a été envoyé.');
    }
  } catch(e){
    document.getElementById('stripe-error').textContent = 'Erreur inattendue : '+e.message;
    btn.innerHTML = 'Confirmer et payer';
    btn.disabled = false;
  }
}

/* ── REALTIME ── */
function connectRealtime(){
  try {
    const ws=new WebSocket(`wss://vuqukiuxzplvaavctypm.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
    ws.onopen=()=>{
      ws.send(JSON.stringify({topic:'realtime:public:products',event:'phx_join',payload:{},ref:'1'}));
      ws.send(JSON.stringify({topic:'realtime:public:brands',event:'phx_join',payload:{},ref:'2'}));
    };
    ws.onmessage=async(e)=>{
      const msg=JSON.parse(e.data);
      if(msg.event==='phx_reply') return;
      if(msg.topic&&(msg.topic.includes('products')||msg.topic.includes('brands'))){
        [products,allBrands]=await Promise.all([sbGet('products?order=id'),sbGet('brands?order=name')]);
        renderAll();
      }
    };
    ws.onclose=()=>setTimeout(connectRealtime,3000);
  } catch(e){}
}

/* ── RENDER PRODUITS ── */
const swatchBgs={p1:'linear-gradient(160deg,#E8D0B0,#C4A070)',p2:'linear-gradient(160deg,#F0D8B8,#D0A878)',p3:'linear-gradient(160deg,#D8C8A0,#B09060)',p4:'linear-gradient(160deg,#F4DEC0,#D8B080)',p5:'linear-gradient(160deg,#E0C8A0,#B89060)',p6:'linear-gradient(160deg,#F8E8C8,#DEC090)',p7:'linear-gradient(160deg,#D0B898,#A88860)',p8:'linear-gradient(160deg,#FCEEDD,#E8C898)'};
function starsHTML(n){return '★'.repeat(n)+'☆'.repeat(5-n)}
const badgeMap={new:'Nouveau',best:'Best Seller',out:'Rupture'};

function productCardHTML(p){
  const bg=swatchBgs[p.img]||swatchBgs.p1;
  const badge=p.badge?`<div class="product-badge badge-${p.badge}">${badgeMap[p.badge]||p.badge}</div>`:'';
  const imgHTML=p.image_url
    ?`<img class="product-img-photo" src="${p.image_url}" alt="${p.name}">`
    :`<div class="product-img-inner" style="background:${bg}"></div>`;
  return `<div class="product-card" onclick="openProduct(${p.id})">
    <div class="product-img">${badge}${imgHTML}</div>
    <div class="product-info">
      <div class="product-brand">${p.brand}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-stars">${starsHTML(p.stars||5)}</div>
      <div class="product-price">${p.price} €</div>
      <div class="product-actions">
        <button class="btn-cart" onclick="event.stopPropagation();addToCartDirect('${p.name.replace(/'/g,"\'")}','${p.brand.replace(/'/g,"\'")}',${p.price},${p.id},'${p.img||'p1'}','${p.image_url||''}')">Ajouter</button>
        <button class="btn-fav" aria-label="Favoris" onclick="event.stopPropagation();quickAddFav('${p.name.replace(/'/g,"\'")}',${p.price},${p.id},'${p.img||'p1'}','${p.image_url||''}')">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 3 14.5 3 8.5a4.5 4.5 0 0 1 9-0.5 4.5 4.5 0 0 1 9 .5c0 6-9 12.5-9 12.5z"/></svg>
        </button>
      </div>
    </div></div>`;
}

function renderAll(){
  const hb=document.getElementById('home-brands');
  if(hb) hb.innerHTML=allBrands.slice(0,4).map(b=>`<div class="brand-card" onclick="showPage('brands')"><div class="brand-name">${b.name}</div><div class="brand-desc">${b.description}</div></div>`).join('');
  const hp=document.getElementById('home-products'); if(hp) hp.innerHTML=products.slice(0,8).map(productCardHTML).join('');
  const np=document.getElementById('new-products'); if(np) np.innerHTML=products.filter(p=>p.is_new||p.badge==='new').map(productCardHTML).join('');
  const bf=document.getElementById('brands-full'); if(bf) bf.innerHTML=allBrands.map(b=>`<div class="brand-card" onclick="showPage('shop')"><div class="brand-name">${b.name}</div><div class="brand-desc">${b.description}</div></div>`).join('');
  const bfilt=document.getElementById('brand-filters'); if(bfilt) bfilt.innerHTML=allBrands.map(b=>`<label class="filter-check"><input type="checkbox"><span>${b.name}</span></label>`).join('');
  filterShop();
}

function filterShop(){
  const q=(document.getElementById('shop-search-input')?.value||'').toLowerCase().trim();
  const maxP=parseInt(document.getElementById('pmax')?.textContent)||500;
  const sort=document.querySelector('.shop-sort select')?.value||'popular';
  let list=products.filter(p=>{
    const ms=!q||p.name.toLowerCase().includes(q)||p.brand.toLowerCase().includes(q)||(p.notes_top||[]).join(' ').toLowerCase().includes(q);
    return ms&&p.price<=maxP;
  });
  if(sort==='price-asc') list.sort((a,b)=>a.price-b.price);
  else if(sort==='price-desc') list.sort((a,b)=>b.price-a.price);
  else if(sort==='new') list=[...list.filter(p=>p.is_new||p.badge==='new'),...list.filter(p=>!p.is_new&&p.badge!=='new')];
  const el=document.getElementById('shop-products');
  if(el) el.innerHTML=list.length?list.map(productCardHTML).join(''):'<div class="no-results">Aucun produit trouvé</div>';
}

function openProduct(id){
  const p=products.find(x=>x.id===id); if(!p) return;
  const bg=swatchBgs[p.img]||swatchBgs.p1;
  document.getElementById('prod-brand').textContent=p.brand.toUpperCase();
  document.getElementById('prod-name').textContent=p.name;
  document.getElementById('prod-breadcrumb').textContent=p.name;
  document.getElementById('prod-price').textContent=p.price+' €';
  document.getElementById('prod-reviews').textContent='('+(p.reviews||0)+' avis)';
  const mainImg=document.getElementById('prod-main-img');
  if(p.image_url){
    mainImg.innerHTML=`<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover">`;
    mainImg.style.background='none';
  } else {
    mainImg.innerHTML='<div class="bottle"></div>';
    mainImg.style.background=bg;
  }
  document.querySelector('.product-detail .stars').textContent=starsHTML(p.stars||5);
  document.getElementById('notes-top').innerHTML=(p.notes_top||[]).map(n=>`<span class="note-tag">${n}</span>`).join('');
  document.getElementById('notes-heart').innerHTML=(p.notes_heart||[]).map(n=>`<span class="note-tag">${n}</span>`).join('');
  document.getElementById('notes-base').innerHTML=(p.notes_base||[]).map(n=>`<span class="note-tag">${n}</span>`).join('');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(tp=>tp.classList.remove('active'));
  document.querySelectorAll('.tab-btn')[0].classList.add('active');
  document.getElementById('tab-desc').classList.add('active');
  document.getElementById('similar-products').innerHTML=products.filter(x=>x.id!==id).slice(0,4).map(productCardHTML).join('');
  showPage('product');
}

/* ── SEARCH ── */
function openSearch(){ document.getElementById('search-overlay').classList.add('open'); document.body.style.overflow='hidden'; setTimeout(()=>document.getElementById('search-global-input').focus(),100); }
function closeSearch(){ document.getElementById('search-overlay').classList.remove('open'); document.body.style.overflow=''; document.getElementById('search-global-input').value=''; document.getElementById('search-results').innerHTML='<div class="search-hint">Tapez pour rechercher dans le catalogue</div>'; }
function closeSearchIfOutside(e){ if(e.target===document.getElementById('search-overlay')) closeSearch(); }
function updateSearchResults(q){
  const res=document.getElementById('search-results');
  if(!q.trim()){ res.innerHTML='<div class="search-hint">Tapez pour rechercher dans le catalogue</div>'; return; }
  const matches=products.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())||p.brand.toLowerCase().includes(q.toLowerCase()));
  if(!matches.length){ res.innerHTML=`<div class="search-empty">Aucun résultat pour « ${q} »</div>`; return; }
  res.innerHTML=matches.slice(0,8).map(p=>`
    <div class="search-result-item" onclick="closeSearch();openProduct(${p.id})">
      ${p.image_url?`<img class="search-result-swatch" src="${p.image_url}" alt="${p.name}" style="object-fit:cover">`:`<div class="search-result-swatch" style="background:${swatchBgs[p.img]||swatchBgs.p1}"></div>`}
      <div><div class="search-result-name">${p.name}</div><div class="search-result-brand">${p.brand}</div></div>
      <div class="search-result-price">${p.price} €</div>
    </div>`).join('');
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){closeSearch();closeAuth();} if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openSearch();} });

/* ── NAV ── */
function showPage(name){ document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); document.querySelectorAll('nav a').forEach(a=>a.classList.remove('active')); const p=document.getElementById('page-'+name); if(p)p.classList.add('active'); const n=document.getElementById('nav-'+name); if(n)n.classList.add('active'); window.scrollTo({top:0,behavior:'smooth'}); }
function switchTab(btn,tabId){ document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); document.getElementById('tab-'+tabId).classList.add('active'); }
function switchAccTab(name){}
function selectSize(btn){ document.querySelectorAll('.size-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }
function selectThumb(el){ document.querySelectorAll('.product-thumb').forEach(t=>t.classList.remove('active')); el.classList.add('active'); }
function subscribeNewsletter(){ const e=document.getElementById('nl-email').value.trim(); if(!e||!e.includes('@')){notif('Email invalide');return;} notif('Bienvenue dans l\'univers AK Fragrance !'); document.getElementById('nl-email').value=''; }

let notifTimer;
function notif(msg){ const el=document.getElementById('notif'); el.textContent=msg; el.classList.add('show'); clearTimeout(notifTimer); notifTimer=setTimeout(()=>el.classList.remove('show'),3500); }

loadData();
renderCart();
// Init
loadData();
renderCart();