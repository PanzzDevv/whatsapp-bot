/**
 * ═══════════════════════════════════════════════════════════
 *  🤖 PANZZSTORE WHATSAPP PAYMENT BOT
 *  Bot WhatsApp khusus admin untuk kirim invoice + QRIS
 *  ke buyer langsung di chat WhatsApp.
 * 
 *  Commands (hanya admin):
 *    .pay <nominal> <deskripsi>  — Kirim QRIS + invoice
 *    .done                       — Konfirmasi pembayaran
 *    .cancel                     — Batalkan invoice
 *    .help                       — Daftar command
 * ═══════════════════════════════════════════════════════════
 */

const path = require('path');
// Load environment variables from the current directory .env
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrTerminal = require('qrcode-terminal');
const fs = require('fs');

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const CONFIG = {
  adminNumber: (process.env.ADMIN_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, ''),
  qrisImagePath: path.resolve(__dirname, process.env.QRIS_IMAGE_PATH || './assets/qris-dana.jpg'),
  storeName: process.env.STORE_NAME_WA || 'PanzzStore',
  commandPrefix: '.',
};

// Track active invoices per chat (chatId -> invoice data)
const activeInvoices = new Map();

// ═══════════════════════════════════════
// WHATSAPP CLIENT SETUP
// ═══════════════════════════════════════

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.AUTH_DATA_PATH || path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
    ],
  },
});

// ═══════════════════════════════════════
// QR CODE & AUTH EVENTS
// ═══════════════════════════════════════

client.on('qr', (qr) => {
  console.log('\n════════════════════════════════════════');
  console.log('📱 SCAN QR CODE INI DENGAN WHATSAPP:');
  console.log('════════════════════════════════════════\n');
  qrTerminal.generate(qr, { small: true });
  console.log('\n════════════════════════════════════════\n');
});

client.on('ready', () => {
  console.log('════════════════════════════════════════');
  console.log(`✅ WhatsApp Payment Bot READY!`);
  console.log(`🏪 Store: ${CONFIG.storeName}`);
  console.log(`👨‍💼 Admin: ${CONFIG.adminNumber}`);
  console.log(`📱 QRIS Path: ${CONFIG.qrisImagePath}`);
  console.log(`💡 Ketik .help di chat WA untuk lihat commands`);
  console.log('════════════════════════════════════════');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Auth gagal:', msg);
  console.log('💡 Hapus folder .wwebjs_auth/ lalu jalankan ulang.');
});

client.on('disconnected', (reason) => {
  console.log('⚠️ WhatsApp terputus:', reason);
});

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

/**
 * Check if message sender is the admin
 */
function isAdmin(msg) {
  // msg.from format: "628xxx@c.us"
  const senderNumber = msg.from.replace('@c.us', '').replace('@s.whatsapp.net', '');
  // In group chats, check msg.author instead
  const authorNumber = msg.author ? msg.author.replace('@c.us', '').replace('@s.whatsapp.net', '') : senderNumber;
  return authorNumber === CONFIG.adminNumber || senderNumber === CONFIG.adminNumber;
}

/**
 * Format number to IDR currency
 */
function formatIDR(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Get current WIB time string
 */
function getWIBTime() {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generate simple order ID
 */
function generateOrderId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `WA-${dateStr}-${random}`;
}

// ═══════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════

/**
 * .help — Show available commands
 */
async function handleHelp(msg) {
  const helpText = 
    `🤖 *${CONFIG.storeName} — WhatsApp Payment Bot*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📋 *Daftar Command:*\n\n` +
    `*.pay <nominal> <deskripsi>*\n` +
    `Kirim invoice + QRIS ke buyer\n` +
    `Contoh: _.pay 50000 Netflix 1 Bulan_\n\n` +
    `*.done*\n` +
    `Konfirmasi pembayaran diterima\n\n` +
    `*.cancel*\n` +
    `Batalkan invoice aktif di chat ini\n\n` +
    `*.help*\n` +
    `Tampilkan pesan ini\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ _Hanya admin yang bisa pakai command_`;

  await msg.reply(helpText);
}

/**
 * .pay <nominal> <deskripsi> — Generate invoice + send QRIS
 */
async function handlePay(msg, args) {
  // Parse arguments
  if (args.length < 2) {
    return msg.reply(
      `❌ *Format salah!*\n\n` +
      `Cara pakai:\n` +
      `*.pay <nominal> <deskripsi>*\n\n` +
      `Contoh:\n` +
      `_.pay 50000 Netflix 1 Bulan_\n` +
      `_.pay 100000 Top Up ML_`
    );
  }

  const nominal = parseInt(args[0]);
  if (isNaN(nominal) || nominal <= 0) {
    return msg.reply(`❌ Nominal tidak valid! Harus angka lebih dari 0.\n\nContoh: _.pay 50000 Netflix 1 Bulan_`);
  }

  const deskripsi = args.slice(1).join(' ');
  const orderId = generateOrderId();
  const chatId = msg.from;

  // Check if QRIS image exists
  if (!fs.existsSync(CONFIG.qrisImagePath)) {
    return msg.reply(
      `❌ *File QRIS tidak ditemukan!*\n\n` +
      `Taruh gambar QRIS Dana Bisnis Anda di:\n` +
      `\`${CONFIG.qrisImagePath}\`\n\n` +
      `Lalu restart bot.`
    );
  }

  // Save active invoice for this chat
  activeInvoices.set(chatId, {
    orderId,
    nominal,
    deskripsi,
    createdAt: new Date().toISOString(),
  });

  // Build invoice message
  const invoiceText =
    `🧾 *INVOICE ${CONFIG.storeName.toUpperCase()}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🆔 *Order:* \`${orderId}\`\n` +
    `📝 *Produk:* ${deskripsi}\n` +
    `💰 *Total:* *${formatIDR(nominal)}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📱 *Scan QRIS di bawah untuk bayar:*\n\n` +
    `⚠️ Pastikan nominal *TEPAT ${formatIDR(nominal)}*\n` +
    `📸 Kirim *bukti transfer* setelah bayar\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏱️ ${getWIBTime()} WIB\n` +
    `🏪 _${CONFIG.storeName}_`;

  // Send QRIS image with invoice caption
  try {
    const media = MessageMedia.fromFilePath(CONFIG.qrisImagePath);
    await client.sendMessage(chatId, media, { caption: invoiceText });
    
    console.log(`💳 Invoice sent: ${orderId} | ${formatIDR(nominal)} | ${deskripsi} | Chat: ${chatId}`);
  } catch (err) {
    console.error('Error sending QRIS:', err);
    await msg.reply(`❌ Gagal mengirim QRIS. Error: ${err.message}`);
  }
}

/**
 * .done — Confirm payment received
 */
async function handleDone(msg) {
  const chatId = msg.from;
  const invoice = activeInvoices.get(chatId);

  if (!invoice) {
    return msg.reply(`ℹ️ Tidak ada invoice aktif di chat ini.`);
  }

  const confirmText =
    `✅ *PEMBAYARAN DIKONFIRMASI!*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🆔 *Order:* \`${invoice.orderId}\`\n` +
    `📝 *Produk:* ${invoice.deskripsi}\n` +
    `💰 *Total:* ${formatIDR(invoice.nominal)}\n\n` +
    `Terima kasih sudah belanja di *${CONFIG.storeName}*! 🙏\n` +
    `Pesanan sedang diproses...\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏱️ ${getWIBTime()} WIB`;

  await client.sendMessage(chatId, confirmText);

  // Remove from active invoices
  activeInvoices.delete(chatId);

  console.log(`✅ Payment confirmed: ${invoice.orderId} | ${formatIDR(invoice.nominal)}`);
}

/**
 * .cancel — Cancel active invoice
 */
async function handleCancel(msg) {
  const chatId = msg.from;
  const invoice = activeInvoices.get(chatId);

  if (!invoice) {
    return msg.reply(`ℹ️ Tidak ada invoice aktif di chat ini.`);
  }

  const cancelText =
    `❌ *INVOICE DIBATALKAN*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🆔 *Order:* \`${invoice.orderId}\`\n` +
    `📝 *Produk:* ${invoice.deskripsi}\n` +
    `💰 *Total:* ${formatIDR(invoice.nominal)}\n\n` +
    `Invoice ini telah dibatalkan oleh admin.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏱️ ${getWIBTime()} WIB\n` +
    `🏪 _${CONFIG.storeName}_`;

  await client.sendMessage(chatId, cancelText);

  activeInvoices.delete(chatId);

  console.log(`❌ Invoice cancelled: ${invoice.orderId}`);
}

// ═══════════════════════════════════════
// MESSAGE LISTENER (CORE ROUTER)
// ═══════════════════════════════════════

client.on('message_create', async (msg) => {
  try {
    // Only process text messages
    if (!msg.body || msg.body.trim() === '') return;

    const body = msg.body.trim();

    // Only process messages starting with command prefix
    if (!body.startsWith(CONFIG.commandPrefix)) return;

    // Only admin can use commands
    if (!isAdmin(msg)) return;

    // Parse command and arguments
    const parts = body.slice(CONFIG.commandPrefix.length).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Route commands
    switch (command) {
      case 'help':
        await handleHelp(msg);
        break;

      case 'pay':
        await handlePay(msg, args);
        break;

      case 'done':
        await handleDone(msg);
        break;

      case 'cancel':
        await handleCancel(msg);
        break;

      default:
        // Unknown command — silently ignore
        break;
    }
  } catch (err) {
    console.error('❌ Error handling message:', err);
  }
});

// ═══════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════

console.log('');
console.log('════════════════════════════════════════');
console.log(`🚀 Starting ${CONFIG.storeName} WhatsApp Payment Bot...`);
console.log('════════════════════════════════════════');
console.log('');

// Validate config
if (!CONFIG.adminNumber) {
  console.error('❌ ADMIN_WHATSAPP_NUMBER belum diset di .env!');
  process.exit(1);
}

if (!fs.existsSync(CONFIG.qrisImagePath)) {
  console.warn(`⚠️ File QRIS tidak ditemukan: ${CONFIG.qrisImagePath}`);
  console.warn(`   Taruh gambar QRIS Dana Bisnis Anda di path tersebut.`);
  console.warn(`   Bot tetap jalan, tapi .pay akan error sampai file QRIS tersedia.\n`);
}

client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await client.destroy();
  process.exit(0);
});
