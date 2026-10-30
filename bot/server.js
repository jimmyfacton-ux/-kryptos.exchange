require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ADMIN_CHAT_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  PORT = 3000,
} = process.env;

if (!TELEGRAM_BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');
if (!TELEGRAM_ADMIN_CHAT_ID) throw new Error('Missing TELEGRAM_ADMIN_CHAT_ID');
if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
if (!SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_KEY');

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const app = express();
app.use(express.json());

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log('Bot started (polling mode)');

// Map: Telegram message_id -> { table, row_id }
const messageMap = new Map();

/* ============ /start command ============ */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Kryptos P2P bot active. Messages from buyers will appear here. Reply to any message to send it back to the buyer.');
});

/* ============ ADMIN REPLIES (from Telegram -> DB) ============ */
bot.on('message', async (msg) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(TELEGRAM_ADMIN_CHAT_ID)) return;
  if (!msg.reply_to_message) return;
  const replyToId = msg.reply_to_message.message_id;
  const mapEntry = messageMap.get(replyToId);
  if (!mapEntry) {
    bot.sendMessage(chatId, 'Warning: could not find the buyer for this message (map lost on restart). Reply manually via admin panel.');
    return;
  }
  const body = msg.text || '[non-text reply]';
  try {
    if (mapEntry.table === 'p2p_pre_messages') {
      const { data: orig } = await sb.from('p2p_pre_messages').select('chat_key, merchant_id, buyer_id, buyer_email').eq('id', mapEntry.row_id).single();
      if (!orig) throw new Error('Original message not found');
      const { error } = await sb.from('p2p_pre_messages').insert({
        chat_key: orig.chat_key,
        merchant_id: orig.merchant_id,
        buyer_id: orig.buyer_id,
        buyer_email: orig.buyer_email,
        sender_id: null,
        sender_role: 'admin',
        body,
      });
      if (error) throw error;
    } else if (mapEntry.table === 'p2p_messages') {
      const { error } = await sb.from('p2p_messages').insert({
        order_id: mapEntry.order_id,
        sender_id: null,
        sender_role: 'admin',
        body,
      });
      if (error) throw error;
    }
    bot.sendMessage(chatId, 'Sent to buyer.');
  } catch (e) {
    console.error('Admin reply failed:', e);
    bot.sendMessage(chatId, 'Error: ' + e.message);
  }
});

/* ============ SUPABASE -> TELEGRAM (new buyer messages) ============ */
async function pollPreMessages() {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from('p2p_pre_messages')
      .select('*')
      .eq('sender_role', 'buyer')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data) return;
    for (const m of data.reverse()) {
      if (messageMap.has('pre:' + m.id)) continue;
      const text =
        'NEW BUYER MESSAGE (pre-order)\n' +
        'From: ' + (m.buyer_email || m.buyer_id || 'unknown') + '\n' +
        'Merchant: ' + (m.merchant_id || 'n/a') + '\n\n' +
        'Message:\n' + m.body + '\n\n' +
        'Reply to THIS message to send back to the buyer.';
      const sent = await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, text);
      messageMap.set('pre:' + m.id, { table: 'p2p_pre_messages', row_id: m.id });
      messageMap.set(sent.message_id, { table: 'p2p_pre_messages', row_id: m.id });
    }
  } catch (e) {
    console.error('pollPreMessages:', e.message);
  }
}

async function pollOrderMessages() {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from('p2p_messages')
      .select('*')
      .eq('sender_role', 'buyer')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data) return;
    for (const m of data.reverse()) {
      if (messageMap.has('ord:' + m.id)) continue;
      const text =
        'NEW BUYER MESSAGE (order)\n' +
        'Order: #' + String(m.order_id).substring(0, 8) + '\n\n' +
        'Message:\n' + m.body + '\n\n' +
        'Reply to THIS message to send back to the buyer.';
      const sent = await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, text);
      messageMap.set('ord:' + m.id, { table: 'p2p_messages', row_id: m.id, order_id: m.order_id });
      messageMap.set(sent.message_id, { table: 'p2p_messages', row_id: m.id, order_id: m.order_id });
    }
  } catch (e) {
    console.error('pollOrderMessages:', e.message);
  }
}

setInterval(pollPreMessages, 5000);
setInterval(pollOrderMessages, 5000);

/* ============ HEALTH CHECK ============ */
app.get('/', (req, res) => res.send('Kryptos bot is running'));
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log('HTTP server on port ' + PORT));
