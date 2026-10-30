/* ============ P2P CHAT ENGINE (unified) ============ */
let chatLastCount = 0;
let preOrderPollTimer = null;
// currentChatOrder, chatPollTimer, currentOrderId declared in p2p.js

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
  const cur = orderData.currency || 'K.Sh';
  return `Hi ${first}, your order #${shortId} for ${amt} USDT (${cur} ${fiat}) is created. Which payment method would you like? I'll send the details right away.`;
}

async function loadChatMessages(forceScroll){
  const threadEl = document.getElementById('chatThread');
  if(!threadEl) return;
  if(!window._currentOrderId){ return loadPreOrderMessages(); }
  try {
    const { data, error } = await sb.rpc('get_p2p_messages', { p_order_id: window._currentOrderId });
    if(error) throw error;
    const msgs = Array.isArray(data) ? data : [];
    const nearBottom = (threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight) < 60;
    if(msgs.length === 0){
      threadEl.innerHTML = `<div class="chat-empty">No messages yet.</div>`;
    } else {
      threadEl.innerHTML = msgs.map(m => {
        const role = (m.sender_role || 'system').toLowerCase();
        const label = role === 'buyer' ? 'You' : role === 'admin' ? 'Support' : role === 'bot' ? 'Bot' : 'System';
        const time = new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        return `<div class="bubble ${role}">${escapeHtml(m.body)}<span class="b-meta">${label} · ${time}</span></div>`;
      }).join('');
    }
    if(forceScroll || nearBottom) threadEl.scrollTop = threadEl.scrollHeight;
  } catch(e){ console.error('loadChatMessages:', e); }
}

async function sendChatMessage(){
  const inp = document.getElementById('chatInput');
  const btn = document.getElementById('chatSend');
  if(!inp || !btn) return;
  const body = inp.value.trim();
  if(!body) return;
  btn.disabled = true;
  try {
    if(!window._currentOrderId){
      const { error } = await sb.from('p2p_pre_messages').insert({
        chat_key: 'preorder_' + window._currentMerchant?.id + '_' + (currentUser?.id || 'anon'),
        merchant_id: window._currentMerchant?.id,
        buyer_id: currentUser?.id,
        buyer_email: currentUser?.email,
        sender_id: currentUser?.id,
        sender_role: 'buyer',
        body: body
      });
      if(error) throw error;
    } else {
      const { data, error } = await sb.rpc('post_p2p_message', {
        p_order_id: window._currentOrderId,
        p_body: body,
        p_role: 'buyer'
      });
      if(error || data?.error) throw new Error(data?.error || error?.message || 'Send failed');
    }
    inp.value = '';
    inp.style.height = '42px';
    await loadChatMessages(true);
  } catch(e){
    toast('Send failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
    inp.focus();
  }
}

async function markAsPaid(){
  if(!window._currentOrderId) return;
  const btn = document.getElementById('btnPaid');
  if(!btn) return;
  if(!confirm('Have you sent the payment? This will notify the merchant.')) return;
  btn.disabled = true;
  btn.textContent = 'Marking…';
  try {
    const { data, error } = await sb.rpc('mark_p2p_paid', { p_order_id: window._currentOrderId });
    if(error || data?.error) throw new Error(data?.error || error?.message || 'Failed');
    btn.textContent = 'Paid';
    toast('Merchant notified.');
    await loadChatMessages(true);
  } catch(e){
    toast('Failed: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = 'I Have Paid';
  }
}

function startChatPolling(){
  stopChatPolling();
  chatPollTimer = setInterval(() => loadChatMessages(false), 3000);
}

function stopChatPolling(){
  if(chatPollTimer){ clearInterval(chatPollTimer); chatPollTimer = null; }
  chatLastCount = 0;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function loadPreOrderMessages(){
  const thread = document.getElementById('chatThread');
  if(!thread || !window._currentMerchant) return;
  try {
    const chatKey = 'preorder_' + window._currentMerchant.id + '_' + (currentUser?.id || 'anon');
    const { data } = await sb.from('p2p_pre_messages')
      .select('*').eq('chat_key', chatKey).order('created_at', {ascending:true});
    if(!data || data.length === 0){
      thread.innerHTML = `<div class="chat-empty">No messages yet. Type below to start.</div>`;
      return;
    }
    thread.innerHTML = data.map(m => {
      const role = (m.sender_role || 'system').toLowerCase();
      const label = role === 'buyer' ? 'You' : role === 'admin' ? 'Support' : role === 'bot' ? 'Bot' : 'System';
      const time = new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      return `<div class="bubble ${role}">${escapeHtml(m.body)}<span class="b-meta">${label} · ${time}</span></div>`;
    }).join('');
    thread.scrollTop = thread.scrollHeight;
  } catch(e){ console.error('pre-order load:', e); }
}

function clearHeaderChatBadge(){
  const b = document.getElementById('headerChatBadge');
  if(b){ b.style.display = 'none'; b.textContent = '0'; }
}
