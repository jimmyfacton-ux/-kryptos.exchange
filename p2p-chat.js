/* ============ P2P CHAT ENGINE ============ */
let currentChatOrder = null;
let chatPollTimer = null;
let chatLastCount = 0;

/* Greeting builder — no emoji, uses first name with fallbacks */
async function buildGreeting(orderData){
  let first = '';
  const meta = currentUser?.user_metadata || {};
  if(meta.first_name) first = meta.first_name;
  if(!first){
    const { data: prof } = await sb.from('profiles').select('first_name').eq('id', currentUser.id).maybeSingle();
    if(prof?.first_name) first = prof.first_name;
  }
  if(!first && currentUser?.email) first = currentUser.email.split('@')[0].split('.')[0];
  if(!first) first = 'there';
  first = first.charAt(0).toUpperCase() + first.slice(1);

  const shortId = orderData.id.substring(0, 8);
  const amt = Number(orderData.amount).toLocaleString('en-US');
  const fiat = orderData.fiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const currency = orderData.currency || 'K.Sh';
  return `Hi ${first}, your order #${shortId} for ${amt} USDT (${currency} ${fiat}) is created. Which payment method would you like? I'll send the details right away.`;
}

/* Main entry — called from submitP2POrder on success */
async function showChatView(orderData){
  currentChatOrder = {
    id: orderData.id,
    amount: Number(orderData.amount),
    fiat: Number(orderData.fiat),
    payment: orderData.payment,
    side: orderData.side,
    merchantName: orderData.merchant?.name || 'Merchant',
    currency: 'K.Sh'
  };

  /* Insert greeting as system message (Step 3 will move this to the bot) */
  const greeting = await buildGreeting(currentChatOrder);
  try {
    await sb.rpc('post_p2p_message', {
      p_order_id: currentChatOrder.id,
      p_body: greeting,
      p_role: 'system'
    });
  } catch(e){
    console.warn('Greeting insert failed:', e);
  }

  renderChatView();
  await loadChatMessages(true);
  startChatPolling();
}

function renderChatView(){
  const o = currentChatOrder;
  if(!o) return;
  const shortId = o.id.substring(0, 8);
  const isBuy = o.side === 'buy';
  const statusLabel = 'pending';

  document.getElementById('modalContent').innerHTML = `
    <div class="chat-head">
      <div class="chat-head-row">
        <div class="chat-head-title">${isBuy ? 'Buy' : 'Sell'} USDT — ${o.merchantName}</div>
        <span class="chat-status" id="chatStatus">${statusLabel}</span>
      </div>
      <div class="chat-head-meta">
        <span class="chat-head-id">#${shortId}</span>
        <span> · </span>
        <strong>${o.amount} USDT</strong>
        <span> · </span>
        <span>${o.currency} ${o.fiat.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}</span>
      </div>
    </div>

    <div class="pay-panel" id="payPanel">
      <div class="pay-panel-head" onclick="document.getElementById('payPanel').classList.toggle('open')">
        <div class="pay-panel-head-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>
          Payment details
        </div>
        <svg class="pay-panel-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      <div class="pay-panel-body">
        <div style="margin-bottom:6px"><strong>Method:</strong> ${(PAY_LABELS[o.payment]||{label:o.payment}).label}</div>
        <div style="margin-bottom:6px"><strong>Amount:</strong> ${o.currency} ${o.fiat.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div class="hint">The merchant will send you the exact number and account name in the chat below. Pay only after you receive these details here.</div>
      </div>
    </div>

    <div class="chat-thread" id="chatThread">
      <div class="chat-empty">Loading messages…</div>
    </div>

    <div class="chat-input-row">
      <textarea class="chat-input" id="chatInput" placeholder="Type a message…" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage();}"></textarea>
      <button class="chat-send" id="chatSend" onclick="sendChatMessage()">Send</button>
    </div>

    <div class="chat-actions">
      <button class="btn-paid" id="btnPaid" onclick="markAsPaid()">I Have Paid</button>
    </div>
  `;

  const inp = document.getElementById('chatInput');
  if(inp){
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 90) + 'px';
    });
  }
}

async function loadChatMessages(forceScroll){
  if(!currentChatOrder) return;
  const threadEl = document.getElementById('chatThread');
  if(!threadEl) return;

  try {
    const { data, error } = await sb.rpc('get_p2p_messages', { p_order_id: currentChatOrder.id });
    if(error) throw error;
    const msgs = Array.isArray(data) ? data : [];

    if(msgs.length === chatLastCount && !forceScroll) return;
    chatLastCount = msgs.length;

    const nearBottom = (threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight) < 60;

    if(msgs.length === 0){
      threadEl.innerHTML = `<div class="chat-empty">No messages yet.</div>`;
    } else {
      threadEl.innerHTML = msgs.map(m => {
        const role = (m.sender_role || 'system').toLowerCase();
        const label = role === 'buyer' ? 'You' : role === 'admin' ? 'Support' : role === 'bot' ? 'Bot' : role === 'system' ? 'System' : role;
        const time = new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        return `<div class="bubble ${role}">${escapeHtml(m.body)}<span class="b-meta">${label} · ${time}</span></div>`;
      }).join('');
    }

    if(forceScroll || nearBottom){
      threadEl.scrollTop = threadEl.scrollHeight;
    }
  } catch(e){
    console.error('loadChatMessages:', e);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendChatMessage(){
  if(!currentChatOrder) return;
  const inp = document.getElementById('chatInput');
  const btn = document.getElementById('chatSend');
  if(!inp || !btn) return;
  const body = inp.value.trim();
  if(!body) return;

  btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('post_p2p_message', {
      p_order_id: currentChatOrder.id,
      p_body: body,
      p_role: 'buyer'
    });
    if(error || data?.error) throw new Error(data?.error || error?.message || 'Send failed');
    inp.value = '';
    inp.style.height = '42px';
    await loadChatMessages(true);
  } catch(e){
    toast('Message failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
    inp.focus();
  }
}

async function markAsPaid(){
  if(!currentChatOrder) return;
  const btn = document.getElementById('btnPaid');
  if(!btn) return;
  if(!confirm('Have you sent the payment? This will notify the merchant.')) return;

  btn.disabled = true;
  btn.textContent = 'Marking…';
  try {
    const { data, error } = await sb.rpc('mark_p2p_paid', { p_order_id: currentChatOrder.id });
    if(error || data?.error) throw new Error(data?.error || error?.message || 'Failed');
    const st = document.getElementById('chatStatus');
    if(st){ st.textContent = 'paid'; st.className = 'chat-status paid'; }
    btn.textContent = 'Paid';
    toast('Merchant notified. Waiting for confirmation.');
    await loadChatMessages(true);
  } catch(e){
    toast('Failed: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = 'I Have Paid';
  }
}

function startChatPolling(){
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    loadChatMessages(false);
  }, 3000);
}

function stopChatPolling(){
  if(chatPollTimer){
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
  chatLastCount = 0;
}
