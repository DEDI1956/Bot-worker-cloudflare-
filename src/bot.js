const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const ADMIN_ID = process.env.ADMIN_ID || "YOUR_ADMIN_TELEGRAM_ID"; // Isi dengan user id admin telegram (bukan username)

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
const app = express();
app.use(express.json());

// ------ Session & Data (ganti ke DB/KV untuk produksi) ------
const sessions = {}; // { [userId]: { step, name, approved, cloudflare:{}, workers: [] } }

// ------------ Express Webhook -------------
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ------------ Menu Grid --------------
const menuKeyboard = {
  inline_keyboard: [
    [
      { text: "🚀 Deploy Worker", callback_data: "deploy_worker" },
      { text: "📦 List Worker", callback_data: "list_worker" }
    ],
    [
      { text: "💾 Set KV Namespace", callback_data: "set_kv" },
      { text: "🔑 Set KV Key", callback_data: "set_kv_key" }
    ],
    [
      { text: "📚 Panduan", callback_data: "help" }
    ]
  ]
};

// ------------ Helper --------------
function isApproved(userId) {
  return sessions[userId] && sessions[userId].approved;
}
function hasCloudflareInfo(userId) {
  const c = sessions[userId]?.cloudflare || {};
  return c.apiToken && c.accountId && c.zoneId && c.kvNamespaceId;
}

// ------------ Bot Logic --------------

// Start - Tampilan awal & Daftar
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  if (!sessions[userId]) sessions[userId] = { step: null, approved: false, workers: [], cloudflare: {} };
  if (!sessions[userId].approved) {
    bot.sendMessage(userId, "Selamat datang di *Cloudflare Worker Manager!*\n\nSilakan daftar dulu untuk akses fitur bot.", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Daftar", callback_data: "register_start" }]
        ]
      }
    });
  } else if (!hasCloudflareInfo(userId)) {
    bot.sendMessage(userId, "🛡️ *Lengkapi data Cloudflare*\n\nSebelum menggunakan bot, silakan input data Cloudflare kamu.\nKetik /cloudflare untuk mulai.");
  } else {
    bot.sendMessage(userId, "🔧 *Cloudflare Worker Manager*\n\nSilakan pilih fitur:", {
      parse_mode: "Markdown",
      reply_markup: menuKeyboard
    });
  }
});

// 1. User klik Daftar
bot.on('callback_query', (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  if (query.data === "register_start") {
    sessions[userId] = { ...(sessions[userId] || {}), step: "input_name", approved: false, workers: [], cloudflare: {} };
    bot.sendMessage(chatId, "Silakan masukkan nama lengkap Anda:");
    return;
  }
  // Admin klik Setujui
  if (query.data && query.data.startsWith("approve_user:")) {
    const [_, approveId] = query.data.split(":");
    sessions[approveId] = { ...(sessions[approveId] || {}), approved: true, step: null, workers: [], cloudflare: {} };
    bot.sendMessage(approveId, "✅ Pendaftaran kamu sudah disetujui admin!\nSilakan lengkapi data Cloudflare dengan /cloudflare.");
    bot.sendMessage(ADMIN_ID, `User (ID: ${approveId}) sudah kamu setujui.`);
    return;
  }

  // Menu fitur utama
  if (isApproved(userId) && hasCloudflareInfo(userId)) {
    if (query.data === "deploy_worker") {
      sessions[userId].step = "input_worker_name";
      bot.sendMessage(chatId, "Masukkan nama Worker yang ingin kamu deploy:");
    }
    if (query.data === "list_worker") {
      const list = sessions[userId].workers || [];
      if (list.length === 0) {
        bot.sendMessage(chatId, "🚫 Belum ada Worker yang kamu deploy.");
      } else {
        let msgList = "📦 *Daftar Worker kamu:*\n\n";
        list.forEach((w, i) => {
          msgList += `${i + 1}. ${w.name}\n`;
        });
        bot.sendMessage(chatId, msgList, { parse_mode: "Markdown" });
      }
    }
    if (query.data === "set_kv") {
      sessions[userId].step = "input_kv_namespace";
      bot.sendMessage(chatId, "Masukkan nama KV Namespace:");
    }
    if (query.data === "set_kv_key") {
      sessions[userId].step = "input_kv_key";
      bot.sendMessage(chatId, "Masukkan nama KV Key:");
    }
    if (query.data === "help") {
      bot.sendMessage(chatId, "📚 *Panduan*\n\n- Daftar & tunggu approve admin\n- Input data Cloudflare (/cloudflare)\n- Deploy Worker: input nama, lalu kode\n- List Worker: lihat daftar Worker kamu\n- Set KV: atur namespace/Key Cloudflare KV\n\nHubungi admin jika butuh bantuan lebih lanjut.", { parse_mode: "Markdown" });
    }
  }
});

// 2. User input data (nama saat daftar, nama Worker, kode Worker, dll)
bot.on('message', async (msg) => {
  // abaikan jika update dari group
  if (!msg.from) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!sessions[userId]) sessions[userId] = { step: null, approved: false, workers: [], cloudflare: {} };
  const session = sessions[userId];

  // Daftar - input nama
  if (session.step === "input_name") {
    session.name = msg.text.trim();
    session.step = "waiting_approval";
    // Kirim ke admin
    bot.sendMessage(ADMIN_ID,
      `🆕 *User Baru Mendaftar*\nNama: ${session.name}\nID: ${userId}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Setujui", callback_data: `approve_user:${userId}` }]
          ]
        }
      }
    );
    bot.sendMessage(chatId, "Pendaftaran kamu sedang menunggu persetujuan admin.");
    return;
  }

  // Input data Cloudflare
  if (msg.text && msg.text.startsWith("/cloudflare")) {
    session.step = "input_api_token";
    bot.sendMessage(chatId, "Masukkan *API Token* Cloudflare kamu:", { parse_mode: "Markdown" });
    return;
  }
  if (session.step === "input_api_token") {
    session.cloudflare.apiToken = msg.text.trim();
    session.step = "input_account_id";
    bot.sendMessage(chatId, "Masukkan *Account ID* Cloudflare kamu:", { parse_mode: "Markdown" });
    return;
  }
  if (session.step === "input_account_id") {
    session.cloudflare.accountId = msg.text.trim();
    session.step = "input_zone_id";
    bot.sendMessage(chatId, "Masukkan *Zone ID* Cloudflare kamu:", { parse_mode: "Markdown" });
    return;
  }
  if (session.step === "input_zone_id") {
    session.cloudflare.zoneId = msg.text.trim();
    session.step = "input_kv_namespace_id";
    bot.sendMessage(chatId, "Masukkan *KV Namespace ID* (Cloudflare KV, contoh: 1234abcd...):", { parse_mode: "Markdown" });
    return;
  }
  if (session.step === "input_kv_namespace_id") {
    session.cloudflare.kvNamespaceId = msg.text.trim();
    session.step = null;
    bot.sendMessage(chatId, "✅ Semua data Cloudflare sudah disimpan!\nKamu bisa akses menu utama dengan /start.");
    return;
  }

  // Deploy Worker - input nama Worker
  if (session.step === "input_worker_name" && isApproved(userId) && hasCloudflareInfo(userId)) {
    session.tempWorkerName = msg.text.trim();
    session.step = "input_worker_code";
    bot.sendMessage(chatId, `Nama Worker: *${session.tempWorkerName}*\nSekarang kirim kode Worker (paste JS):`, { parse_mode: "Markdown" });
    return;
  }
  // Deploy Worker - input kode Worker
  if (session.step === "input_worker_code" && isApproved(userId) && hasCloudflareInfo(userId)) {
    const workerCode = msg.text;
    if (!session.tempWorkerName) {
      bot.sendMessage(chatId, "⚠️ Nama Worker tidak ditemukan. Ulangi proses deploy.");
      session.step = null;
      return;
    }
    // TODO: Deploy ke Cloudflare di sini!
    // Kamu bisa pakai fetch ke API Cloudflare, gunakan session.cloudflare.apiToken, accountId, kvNamespaceId, dll

    // Simulasi: langsung sukses
    session.workers = session.workers || [];
    session.workers.push({ name: session.tempWorkerName, code: workerCode, created: Date.now() });
    bot.sendMessage(chatId, `✅ Worker *${session.tempWorkerName}* berhasil di-deploy!`, { parse_mode: "Markdown" });
    session.tempWorkerName = null;
    session.step = null;
    return;
  }

  // Set KV Namespace
  if (session.step === "input_kv_namespace" && isApproved(userId) && hasCloudflareInfo(userId)) {
    session.cloudflare.kvNamespace = msg.text.trim();
    session.step = null;
    bot.sendMessage(chatId, `✅ KV Namespace di-set ke: *${session.cloudflare.kvNamespace}*`, { parse_mode: "Markdown" });
    return;
  }
  // Set KV Key
  if (session.step === "input_kv_key" && isApproved(userId) && hasCloudflareInfo(userId)) {
    session.cloudflare.kvKey = msg.text.trim();
    session.step = null;
    bot.sendMessage(chatId, `✅ KV Key di-set ke: *${session.cloudflare.kvKey}*`, { parse_mode: "Markdown" });
    return;
  }
});

// ------------ SERVER LISTEN (RAILWAY READY) -------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot is running on port " + PORT);
  // Petunjuk set webhook (ganti URL sesuai Railway deploy)
  console.log(`Set webhook ke: https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=https://<YOUR_RAILWAY_URL>/bot${TELEGRAM_BOT_TOKEN}`);
});
