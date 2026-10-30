/* ============ SUPABASE ============ */
const SUPABASE_URL = 'https://pzqwmrqdqtozvwfpdmpm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZeJhMI2y2yWGyQ7Aqx_T6A_vyEuVkxJ';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentSide = 'buy';
let allMerchants = [];
let currentBalance = 0;
let balanceHidden = false;
let currentChatOrder = null;
let chatPollTimer = null;

const USD_PRICE = { BTC: 81223.18, USDT: 1.00, ETH: 2358.02, SOL: 102.36, BNB: 612.45 };

const PAY_LABELS = {
  mpesa:{label:"M-PESA Safaricom", cls:"mpesa"},
  bank:{label:"Bank Transfer", cls:"bank"},
  equity:{label:"Equity Bank", cls:"bank"},
  kcb:{label:"KCB Bank", cls:"bank"},
  airtel:{label:"Airtel Money", cls:"airtel"},
};
const STATUS = {
  online:{cls:"status-online", label:"Online"},
  recent:{cls:"status-recent", label:"4 mins ago"},
  late:{cls:"status-late", label:"1 hour ago"},
};
const VERIFIED_SVG = `<svg class="verified" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/></svg>`;

/* ============ INIT ============ */
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if(!session){ location.href = 'login.html'; return; }
  currentUser = session.user;
  await setAvatar(currentUser);
  await loadHeaderBalance();
  await loadMerchants();
})();

async function setAvatar(user){
  const meta = user.user_metadata || {};
  let initial = '';
  if(meta.first_name) initial = meta.first_name[0];
  else if(meta.last_name) initial = meta.last_name[0];
  if(!initial){
    const { data: prof } = await sb.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle();
    if(prof){
      if(prof.first_name) initial = prof.first_name[0];
      else if(prof.last_name) initial = prof.last_name[0];
    }
  }
  if(!initial && user.email) initial = user.email[0];
  if(!initial) initial = '?';
  return initial.toUpperCase();
}

async function loadHeaderBalance(){
  if(!currentUser) return;
  const { data } = await sb.from('balances').select('coin, amount').eq('user_id', currentUser.id);
  currentBalance = 0;
  if(data) data.forEach(b => currentBalance += Number(b.amount) * (USD_PRICE[b.coin] || 0));

  const meta = currentUser.user_metadata || {};
  let initial = '?';
  if(meta.first_name) initial = meta.first_name[0];
  else if(meta.last_name) initial = meta.last_name[0];
  else if(currentUser.email) initial = currentUser.email[0];
  initial = initial.toUpperCase();

  const wrap = document.getElementById('headerAuth');
  const v = '$' + currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  wrap.innerHTML = `
    <div class="balance">
      <span class="balance-val" id="hdrBal">${balanceHidden ? '****' : v}</span>
      <button class="balance-eye" id="hdrEye"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg></button>
    </div>
    <a href="wallet.html" class="avatar">${initial}</a>
    <button class="notif-btn" aria-label="Notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>
      <span class="notif-badge" id="notifBadge">0</span>
    </button>
  `;
  document.getElementById('hdrEye').addEventListener('click', () => {
    balanceHidden = !balanceHidden;
    document.getElementById('hdrBal').textContent = balanceHidden ? '****' : v;
  });
}

/* ============ LOAD MERCHANTS ============ */
async function loadMerchants(){
  const list = document.getElementById('merchantList');
  list.innerHTML = `<div class="empty-state">Loading merchants...</div>`;
  const { data, error } = await sb.from('merchants').select('*').order('price_kes', {ascending:true});
  if(error){ list.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`; return; }
  allMerchants = data || [];
  renderMerchants();
}

function renderMerchants(){
  const list = document.getElementById('merchantList');
  if(allMerchants.length === 0){
    list.innerHTML = `<div class="empty-state">No merchants available right now.</div>`;
    return;
  }
  const actionLabel = currentSide === 'buy' ? 'Buy' : 'Sell';
  const actionClass = currentSide === 'buy' ? 'buy-btn' : 'buy-btn sell';

  list.innerHTML = allMerchants.map(m => {
    const st = STATUS[m.status] || STATUS.online;
    const chips = (m.payments || []).map(p => {
      const pl = PAY_LABELS[p] || {label: p, cls: 'bank'};
      return `<span class="pay-chip"><span class="bar ${pl.cls}"></span>${pl.label}</span>`;
    }).join('');
    return `<div class="merchant">
      <div class="merchant-head">
        <div class="merchant-name-wrap">
          <button class="merchant-name">${m.name}</button>
          ${VERIFIED_SVG}
          <span class="status ${st.cls}"><span class="dot"></span>${st.label}</span>
        </div>
        <button class="view-profile">View Profile &gt;</button>
      </div>
      <div class="merchant-stats">
        <span>Trades ${Number(m.trades).toLocaleString()} (${m.rating}%)</span><span class="sep">·</span>
        <span>👍 99%</span><span class="sep">·</span>
        <span>30 min</span>
      </div>
      <div class="merchant-price">
        <span class="cur">K.Sh</span>
        <span class="val">${Number(m.price_kes).toFixed(2)}</span>
        <span class="unit">/USDT</span>
      </div>
      <div class="merchant-foot">
        <div class="merchant-meta">
          <div class="row">Limit ${Number(m.limit_min).toLocaleString()}-${Number(m.limit_max).toLocaleString()} KES</div>
          <div class="row">Available ${Number(m.available_usdt).toLocaleString()} USDT</div>
          <div class="pay-chips">${chips}</div>
        </div>
        <button class="${actionClass}" onclick="openP2PModal('${m.id}')">${actionLabel}</button>
      </div>
    </div>`;
  }).join('');
}

document.querySelectorAll('#buySell button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#buySell button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentSide = b.dataset.side;
    renderMerchants();
  });
});

document.querySelectorAll('.sub-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.sub-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
  });
});

/* ============ P2P MODAL ============ */
function openP2PModal(merchantId, startTab){
  const m = allMerchants.find(x => x.id === merchantId);
  if(!m) return;
  const isBuy = currentSide === 'buy';
  const actionVerb = isBuy ? 'Buy' : 'Sell';
  const minAmt = (Number(m.limit_min) / Number(m.price_kes)).toFixed(2);
  const maxAmt = (Number(m.limit_max) / Number(m.price_kes)).toFixed(2);

  document.getElementById('modalContent').innerHTML = `
    <div class="p2p-tabs">
      <button class="p2p-tab active" data-ptab="order" onclick="switchP2PTab('order')">Order</button>
      <button class="p2p-tab" data-ptab="chat" onclick="switchP2PTab('chat')">
        <span>Messages</span>
        <span class="p2p-tab-badge" id="p2pTabBadge" style="display:none">0</span>
      </button>
    </div>

    <div id="p2pTabOrder">
      <div class="modal-title">${actionVerb} USDT from ${m.name}</div>
      <div class="modal-sub">You will ${isBuy ? 'send KES via' : 'receive KES via'} your chosen payment method</div>
      <div class="modal-info">
        <div class="modal-info-row"><span>Price</span><span>K.Sh ${Number(m.price_kes).toFixed(2)} / USDT</span></div>
        <div class="modal-info-row"><span>Available</span><span>${Number(m.available_usdt).toLocaleString()} USDT</span></div>
        <div class="modal-info-row"><span>Limits</span><span>K.Sh ${Number(m.limit_min).toLocaleString()} – ${Number(m.limit_max).toLocaleString()}</span></div>
      </div>
      <label class="modal-label">Amount (USDT) — ${minAmt} to ${maxAmt}</label>
      <input class="modal-input" type="number" step="any" id="p2pAmount" placeholder="0.00" />
      <label class="modal-label">Payment Method</label>
      <select class="modal-input" id="p2pPayment">
        ${(m.payments||[]).map(p => `<option value="${p}">${(PAY_LABELS[p]||{label:p}).label}</option>`).join('')}
      </select>
      <div class="modal-info" style="margin-top:6px">
        <div class="modal-info-row"><span>You will ${isBuy?'pay':'receive'}</span><strong id="p2pFiat">K.Sh 0.00</strong></div>
      </div>
      <button class="modal-confirm ${isBuy?'':'sell'}" id="p2pSubmit" onclick="submitP2POrder('${m.id}')">${actionVerb} USDT</button>
      <div class="msg" id="p2pMsg"></div>
    </div>

    <div id="p2pTabChat" style="display:none">
      <div class="chat-thread" id="chatThread">
        <div class="chat-empty">No order yet. Type a message to start chatting — support will reply shortly.</div>
      </div>
      <div class="chat-input-row">
        <textarea class="chat-input" id="chatInput" placeholder="Type a message…" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage();}"></textarea>
        <button class="chat-send" id="chatSend" onclick="sendChatMessage()">Send</button>
      </div>
      <div class="chat-actions" id="chatActions" style="display:none">
        <button class="btn-paid" id="btnPaid" onclick="markAsPaid()">I Have Paid</button>
      </div>
    </div>
  `;

  window._currentMerchant = m;
  window._currentOrderId = null;

  setTimeout(() => {
    const inp = document.getElementById('p2pAmount');
    const out = document.getElementById('p2pFiat');
    if(inp && out){
      inp.addEventListener('input', () => {
        const amt = parseFloat(inp.value) || 0;
        const fiat = amt * Number(m.price_kes);
        out.textContent = 'K.Sh ' + fiat.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
      });
      inp.focus();
    }
    const ci = document.getElementById('chatInput');
    if(ci){
      ci.addEventListener('input', () => {
        ci.style.height = 'auto';
        ci.style.height = Math.min(ci.scrollHeight, 90) + 'px';
      });
    }
  }, 50);

  document.getElementById('modalBackdrop').classList.add('show');
  document.body.style.overflow = 'hidden';

  if(startTab === 'chat') switchP2PTab('chat');
}

function switchP2PTab(tab){
  document.querySelectorAll('.p2p-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.ptab === tab);
  });
  const order = document.getElementById('p2pTabOrder');
  const chat  = document.getElementById('p2pTabChat');
  if(order) order.style.display = tab === 'order' ? 'block' : 'none';
  if(chat)  chat.style.display  = tab === 'chat'  ? 'block' : 'none';

  if(tab === 'chat'){
    const badge = document.getElementById('p2pTabBadge');
    if(badge){ badge.style.display = 'none'; badge.textContent = '0'; }
    clearHeaderChatBadge();
    if(window._currentOrderId) startChatPolling();
    else loadPreOrderMessages();
  } else {
    stopChatPolling();
  }
}

function closeModal(){
  stopChatPolling();
  currentChatOrder = null;
  document.getElementById('modalBackdrop').classList.remove('show');
  document.getElementById('modalContent').innerHTML = '';
  document.body.style.overflow = '';
}
document.getElementById('modalBackdrop').addEventListener('click', e => {
  if(e.target.id === 'modalBackdrop') closeModal();
});

async function submitP2POrder(merchantId){
  const m = allMerchants.find(x => x.id === merchantId);
  if(!m) return;
  const amt = parseFloat(document.getElementById('p2pAmount').value);
  const pay = document.getElementById('p2pPayment').value;
  const btn = document.getElementById('p2pSubmit');

  if(!amt || amt <= 0){ showP2PMsg('error','Enter a valid amount.'); return; }
  if(amt > Number(m.available_usdt)){ showP2PMsg('error','Amount exceeds merchant availability.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Submitting...';

  try {
    const { data, error } = await sb.rpc('create_p2p_order', {
      p_merchant_id: merchantId,
      p_amount: amt,
      p_payment: pay,
      p_side: currentSide
    });
    if(error || data?.error) throw new Error(data?.error || error?.message || 'Order failed');
    if(!data.order_id) throw new Error('Order created but no ID returned.');

    window._currentOrderId = data.order_id;
    window._currentOrderData = {
      id: data.order_id,
      amount: amt,
      fiat: Number(data.fiat),
      payment: pay,
      side: currentSide,
      merchantName: m.name,
      currency: 'K.Sh'
    };

    try {
      const greeting = await buildGreeting(window._currentOrderData);
      await sb.rpc('post_p2p_message', {
        p_order_id: data.order_id,
        p_body: greeting,
        p_role: 'system'
      });
    } catch(e){ console.warn('Greeting insert:', e); }

    const actions = document.getElementById('chatActions');
    if(actions) actions.style.display = 'flex';

    const tabBadge = document.getElementById('p2pTabBadge');
    if(tabBadge){ tabBadge.style.display = 'inline-block'; tabBadge.textContent = '1'; }

    toast('Order created — tap Messages to chat');
    loadMerchants();
    loadHeaderBalance();

    switchP2PTab('chat');
    await loadChatMessages(true);
    startChatPolling();
  } catch(err){
    showP2PMsg('error', err.message);
    btn.disabled = false;
    btn.textContent = (currentSide === 'buy' ? 'Buy' : 'Sell') + ' USDT';
  }
}

function showP2PMsg(type, txt){
  const el = document.getElementById('p2pMsg');
  if(!el) return;
  el.className = 'msg show ' + type;
  el.textContent = txt;
}

/* ============ DRAWER ============ */
function openDrawer(){
  document.getElementById('drawerBackdrop').classList.add('show');
  document.body.style.overflow = 'hidden';
  renderDrawerAuth();
}
function closeDrawer(){
  document.getElementById('drawerBackdrop').classList.remove('show');
  document.body.style.overflow = '';
}
function toggleGroup(name){
  const group = document.getElementById('group-' + name);
  if(!group) return;
  const isOpen = group.classList.contains('open');
  group.classList.toggle('open', !isOpen);
  const section = group.previousElementSibling;
  if(section) section.classList.toggle('open', !isOpen);
}
document.getElementById('drawerBackdrop').addEventListener('click', e => {
  if(e.target.id === 'drawerBackdrop') closeDrawer();
});

async function renderDrawerAuth(){
  const wrap = document.getElementById('drawerAuth');
  if(!wrap) return;
  if(!currentUser){
    wrap.innerHTML = `<a href="login.html" class="drawer-auth-btn login">Log in</a><a href="signup.html" class="drawer-auth-btn signup">Create account</a>`;
    return;
  }
  const meta = currentUser.user_metadata || {};
  let initial = '?';
  if(meta.first_name) initial = meta.first_name[0];
  else if(meta.last_name) initial = meta.last_name[0];
  else if(currentUser.email) initial = currentUser.email[0];
  initial = initial.toUpperCase();
  const bal = '$' + currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  wrap.innerHTML = `
    <div class="drawer-user">
      <div class="drawer-user-avatar">${initial}</div>
      <div style="min-width:0;flex:1"><div class="drawer-user-email">${currentUser.email || ''}</div><div class="drawer-user-bal">${bal}</div></div>
    </div>
    <a href="wallet.html" class="drawer-auth-btn login">My wallet</a>
    <button onclick="doLogout()" class="drawer-auth-btn logout">Log out</button>
  `;
}
async function doLogout(){
  if(confirm('Log out of KRYPTOS?')){
    await sb.auth.signOut();
    location.href = 'login.html';
  }
}

/* ============ LIVE RATE ============ */
let rate = 129.90;
setInterval(() => {
  rate += (Math.random() - 0.5) * 0.3;
  const el = document.querySelector('.live-rate strong');
  if(el) el.textContent = '1 USDT ≈ K.Sh' + rate.toFixed(2);
}, 4000);

/* ============ TOAST ============ */
function toast(msg, isError){
  const t = document.getElementById('toast');
  t.className = 'toast show' + (isError ? ' error' : '');
  document.getElementById('toastMsg').textContent = msg;
  setTimeout(() => t.classList.remove('show'), 3500);
}
