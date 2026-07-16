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
const express = require('express');
const QRCode = require('qrcode');

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const CONFIG = {
  adminNumber: (process.env.ADMIN_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, ''),
  qrisImagePath: path.resolve(__dirname, process.env.QRIS_IMAGE_PATH || './assets/qris-dana.jpg'),
  storeName: process.env.STORE_NAME_WA || 'PanzzStore',
  commandPrefix: '.',
  catalogLink: process.env.CATALOG_LINK || '',
};

// Express Setup
const app = express();
const PORT = process.env.PORT || 3000;
let qrCodeDataUrl = null;
let isConnected = false;

// Track active invoices per chat (chatId -> invoice data)
const activeInvoices = new Map();

// ═══════════════════════════════════════
// STALE LOCKS CLEANUP (RAILWAY/DOCKER FIX)
// ═══════════════════════════════════════

const authPath = process.env.AUTH_DATA_PATH || path.join(__dirname, '.wwebjs_auth');
function cleanStaleLocks(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch (e) {
        // Skip files that are broken symlinks or inaccessible
        continue;
      }
      if (stat.isDirectory()) {
        cleanStaleLocks(fullPath);
      } else if (file === 'SingletonLock') {
        try {
          fs.unlinkSync(fullPath);
          console.log(`🧹 Deleted stale Chromium lock: ${fullPath}`);
        } catch (err) {
          console.error(`⚠️ Failed to delete lock ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('Error reading auth directory for cleanup:', err.message);
  }
}
cleanStaleLocks(authPath);

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

  // Convert QR code to base64 Data URL for web display
  QRCode.toDataURL(qr, (err, url) => {
    if (!err) {
      qrCodeDataUrl = url;
    }
  });
});

client.on('ready', () => {
  isConnected = true;
  qrCodeDataUrl = null;
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
  isConnected = false;
});

// ═══════════════════════════════════════
// WEB PORTAL ROUTES
// ═══════════════════════════════════════

app.get('/', (req, res) => {
  if (isConnected) {
    return res.send(`
      <html>
        <head>
          <title>${CONFIG.storeName} WA Bot</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: sans-serif; text-align: center; padding: 50px; background: #f0f2f5; color: #1c1e21; display: flex; align-items: center; justify-content: center; height: 80vh; margin: 0; }
            .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
            h1 { color: #25d366; margin-bottom: 10px; }
            .status { font-weight: bold; color: #25d366; font-size: 1.2em; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${CONFIG.storeName} Bot</h1>
            <p class="status">✅ WhatsApp Bot Connected & Running!</p>
            <p style="color: #606770;">Anda bisa menutup halaman ini sekarang.</p>
          </div>
        </body>
      </html>
    `);
  }

  if (!qrCodeDataUrl) {
    return res.send(`
      <html>
        <head>
          <title>Generating QR...</title>
          <meta http-equiv="refresh" content="3">
          <style>
            body { font-family: sans-serif; text-align: center; padding: 50px; background: #f0f2f5; display: flex; align-items: center; justify-content: center; height: 80vh; margin: 0; }
            .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
            .spinner { border: 4px solid rgba(0,0,0,0.1); width: 36px; height: 36px; border-radius: 50%; border-left-color: #09f; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>⏳ Menyiapkan QR Code...</h2>
            <div class="spinner"></div>
            <p style="color: #606770;">Sedang menyiapkan sesi WhatsApp Web, halaman ini akan otomatis memuat ulang.</p>
          </div>
        </body>
      </html>
    `);
  }

  res.send(`
    <html>
      <head>
        <title>Scan WhatsApp QR Code</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 30px; background: #f0f2f5; color: #1c1e21; display: flex; align-items: center; justify-content: center; min-height: 90vh; margin: 0; }
          .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 6px 18px rgba(0,0,0,0.1); max-width: 450px; width: 100%; }
          h1 { color: #075e54; margin-top: 0; }
          img { max-width: 250px; width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; padding: 10px; background: white; margin: 15px auto; display: block; }
          .instructions { text-align: left; margin: 20px 0; font-size: 0.95em; line-height: 1.5; color: #4a4a4a; background: #f9f9f9; padding: 15px; border-radius: 8px; }
          ol { padding-left: 20px; margin: 8px 0 0 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Scan QR Code</h1>
          <p>Scan QR code di bawah ini untuk menghubungkan bot WhatsApp.</p>
          <img src="${qrCodeDataUrl}" alt="WhatsApp QR Code" />
          <div class="instructions">
            <strong>Cara Menghubungkan:</strong>
            <ol>
              <li>Buka WhatsApp di HP Anda.</li>
              <li>Ketuk menu <strong>Linked Devices</strong> (Perangkat Tertaut).</li>
              <li>Ketuk <strong>Link a Device</strong> (Tautkan Perangkat).</li>
              <li>Arahkan kamera HP Anda ke kode QR di atas.</li>
            </ol>
          </div>
          <p style="font-size: 0.8em; color: #888;">Halaman ini akan otomatis dialihkan setelah berhasil masuk.</p>
        </div>
        <script>
          // Cek status koneksi setiap 3 detik
          setInterval(() => {
            fetch('/status')
              .then(res => res.json())
              .then(data => {
                if (data.connected) {
                  window.location.reload();
                }
              });
          }, 3000);
        </script>
      </body>
    </html>
  `);
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

app.listen(PORT, () => {
  console.log(`📡 Web Portal QR Code berjalan di http://localhost:${PORT}`);
});

// ═══════════════════════════════════════
// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

/**
 * Check if message sender is the admin
 */
function isAdmin(msg) {
  if (msg.fromMe) return true;
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
  const chatId = msg.fromMe ? msg.to : msg.from;
  const helpText = 
    `🤖 *${CONFIG.storeName.toUpperCase()} BOT MENU*\n` +
    `───────────────────\n` +
    ` ▪️ *.pay <nominal> <deskripsi>*\n` +
    `     Kirim invoice & QRIS ke buyer.\n` +
    ` ▪️ *.done*\n` +
    `     Konfirmasi pembayaran sukses.\n` +
    ` ▪️ *.cancel*\n` +
    `     Batalkan invoice aktif.\n` +
    ` ▪️ *.help*\n` +
    `     Tampilkan menu bantuan ini.\n` +
    `───────────────────\n` +
    ` ⚠️ Admin Only Command`;

  await client.sendMessage(chatId, helpText);
}

/**
 * .pay <nominal> <deskripsi> — Generate invoice + send QRIS
 */
async function handlePay(msg, args) {
  const chatId = msg.fromMe ? msg.to : msg.from;
  // Parse arguments
  if (args.length < 2) {
    return client.sendMessage(chatId,
      `❌ *Format salah!*\n\n` +
      `Cara pakai:\n` +
      `*.pay <nominal> <deskripsi>*\n\n` +
      `Contoh:\n` +
      `_.pay 50000 Netflix 1 Bulan_`
    );
  }

  const nominal = parseInt(args[0]);
  if (isNaN(nominal) || nominal <= 0) {
    return client.sendMessage(chatId, `❌ Nominal tidak valid! Harus angka lebih dari 0.`);
  }

  const deskripsi = args.slice(1).join(' ');
  const orderId = generateOrderId();

  // Check if QRIS image exists
  if (!fs.existsSync(CONFIG.qrisImagePath)) {
    return client.sendMessage(chatId,
      `❌ *File QRIS tidak ditemukan!*\n\n` +
      `Taruh gambar QRIS Dana Bisnis Anda di:\n` +
      `\`${CONFIG.qrisImagePath}\``
    );
  }

  // Save active invoice for this chat
  activeInvoices.set(chatId, {
    orderId,
    nominal,
    deskripsi,
    createdAt: new Date().toISOString(),
  });

  // Build invoice message (Cyberpunk Style)
  const invoiceText =
    `🧾 *${CONFIG.storeName.toUpperCase()} INVOICE*\n` +
    `───────────────────\n` +
    ` ▪️ Order ID   : \`${orderId}\`\n` +
    ` ▪️ Item       : ${deskripsi}\n` +
    ` ▪️ Total Bill : *${formatIDR(nominal)}*\n` +
    `───────────────────\n` +
    ` 📱 Pindai QRIS di bawah untuk bayar.\n` +
    ` 📸 Kirim bukti transfer ke chat ini.\n` +
    `───────────────────\n` +
    ` 🏪 Thank you for shopping with us!`;

  // Send QRIS image + Invoice text quoting the Verified Catalog Card
  try {
    const media = MessageMedia.fromFilePath(CONFIG.qrisImagePath);

    // 1. Send the clean full-size QRIS image first
    await client.sendMessage(chatId, media);

    // 2. Read the image as base64 for the custom catalog thumbnail
    let base64Thumb = '';
    if (fs.existsSync(CONFIG.qrisImagePath)) {
      base64Thumb = fs.readFileSync(CONFIG.qrisImagePath, { encoding: 'base64' });
    }

    // 3. Send the invoice text quoting the verified catalog card in one single message!
    await client.pupPage.evaluate(async (chatId, title, invoiceText, base64) => {
      // Helper to dynamically wait until WWebJS modules are ready
      const getModule = (name) => {
        return new Promise((resolve) => {
          if (typeof window.require !== 'undefined') {
            try {
              const mod = window.require(name);
              if (mod) return resolve(mod);
            } catch (e) {}
          }
          const interval = setInterval(() => {
            if (typeof window.require !== 'undefined') {
              try {
                const mod = window.require(name);
                if (mod) {
                  clearInterval(interval);
                  resolve(mod);
                }
              } catch (e) {}
            }
          }, 100);
          setTimeout(() => {
            clearInterval(interval);
            resolve(null);
          }, 8000);
        });
      };

      const WidFactory = await getModule('WAWebWidFactory');
      const Collections = await getModule('WAWebCollections');
      const MsgKey = await getModule('WAWebMsgKey');
      const SendMsgChatAction = await getModule('WAWebSendMsgChatAction');
      const UserPrefsMeUser = await getModule('WAWebUserPrefsMeUser');

      if (!WidFactory || !Collections || !MsgKey || !SendMsgChatAction || !UserPrefsMeUser) {
        throw new Error('Required WhatsApp Web modules failed to load within timeout');
      }

      const chatWid = WidFactory.createWid(chatId);
      const chat = await Collections.Chat.find(chatWid);
      const newId = await window.require('WAWebMsgKey').newId();
      const from = UserPrefsMeUser.getMaybeMePnUser();

      const newMsgKey = new MsgKey({
        from: from,
        to: chat.id,
        id: newId,
        selfDir: 'out',
      });

      // Create fake quoted order message (verified catalog look)
      const fakeQuoted = {
        id: {
          fromMe: false,
          remote: WidFactory.createWid('status@broadcast'),
          id: 'FAKE_' + Math.random().toString(36).substring(2, 15).toUpperCase(),
          _serialized: `false_status@broadcast_FAKE`
        },
        type: 'order',
        body: title,
        orderId: '2029',
        itemCount: '9999',
        status: 1, // INQUIRY
        surface: 'CATALOG',
        sellerJid: from.toString(),
        token: 'AR6xBKbXZn0Xwmu76Ksyd7rnxI+Rx87HfinVlW4lwXa6JA==',
        thumbnail: base64,
        caption: title,
        participant: WidFactory.createWid('0@s.whatsapp.net'),
        isForwarded: true,
        forwardingScore: 999
      };

      const message = {
        id: newMsgKey,
        ack: 0,
        body: invoiceText,
        from: from,
        to: chat.id,
        local: true,
        self: 'out',
        t: parseInt(new Date().getTime() / 1000),
        isNewMsg: true,
        type: 'chat',
        quotedMsg: fakeQuoted,
        quotedStanzaID: fakeQuoted.id.id,
        quotedParticipant: fakeQuoted.participant
      };

      await SendMsgChatAction.addAndSendMsgToChat(chat, message);
    }, chatId, "Panzztzy ☇ Crasher", invoiceText, base64Thumb);

    console.log(`💳 Invoice sent: ${orderId} | ${formatIDR(nominal)} | ${deskripsi} | Chat: ${chatId}`);
  } catch (err) {
    console.error('Error sending invoice:', err);
    // Fallback: Send plain text invoice
    try {
      await client.sendMessage(chatId, invoiceText + '\n\n⚠️ _Gagal mengirim visual preview, silakan transfer manual ke QRIS di atas._');
    } catch (fallbackErr) {
      console.error('Fallback message sending failed:', fallbackErr.message);
    }
  }
}

/**
 * .done — Confirm payment received
 */
async function handleDone(msg) {
  const chatId = msg.fromMe ? msg.to : msg.from;
  const invoice = activeInvoices.get(chatId);

  if (!invoice) {
    return client.sendMessage(chatId, `ℹ️ Tidak ada invoice aktif di chat ini.`);
  }

  const confirmText =
    `✅ *PAYMENT SUCCESSFUL*\n` +
    `───────────────────\n` +
    ` Pembayaran untuk order \`${invoice.orderId}\` telah diterima.\n` +
    ` Pesanan Anda sedang diproses oleh admin. Terima kasih!\n` +
    `───────────────────\n` +
    ` ⏱️ ${getWIBTime()} WIB`;

  await client.sendMessage(chatId, confirmText);

  // Remove from active invoices
  activeInvoices.delete(chatId);

  console.log(`✅ Payment confirmed: ${invoice.orderId} | ${formatIDR(invoice.nominal)}`);
}

/**
 * .cancel — Cancel active invoice
 */
async function handleCancel(msg) {
  const chatId = msg.fromMe ? msg.to : msg.from;
  const invoice = activeInvoices.get(chatId);

  if (!invoice) {
    return client.sendMessage(chatId, `ℹ️ Tidak ada invoice aktif di chat ini.`);
  }

  const cancelText =
    `❌ *INVOICE CANCELLED*\n` +
    `───────────────────\n` +
    ` Transaksi dengan Order ID \`${invoice.orderId}\` telah dibatalkan oleh admin.\n` +
    `───────────────────`;

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
