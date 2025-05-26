const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');
require('dotenv').config(); // Untuk memuat variabel lingkungan dari file .env

// --- KONFIGURASI ---
// Ambil API Key Gemini dari variabel lingkungan
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ID Model Gemini yang ingin digunakan (misalnya, 'gemini-pro' atau 'gemini-1.5-flash')
const MODEL_NAME = "gemini-1.5-flash"; // Anda bisa ganti dengan model lain
// Prefix untuk memanggil bot (opsional, bisa dikosongkan jika ingin merespons semua pesan)
const BOT_PREFIX = "!gemini"; // Contoh: !gemini Apa kabar?

// --- Validasi API Key ---
if (!GEMINI_API_KEY) {
    console.error("Kesalahan: API_KEY tidak ditemukan. Silakan set di file .env");
    process.exit(1); // Keluar dari aplikasi jika API Key tidak ada
}

// --- Inisialisasi Klien WhatsApp ---
console.log("Menginisialisasi klien WhatsApp...");
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: "session_data" // Menyimpan sesi agar tidak perlu scan QR terus-menerus
    }),
    puppeteer: {
        headless: true, // Jalankan browser di background
        // args: ['--no-sandbox', '--disable-setuid-sandbox'] // Uncomment jika berjalan di lingkungan Linux tertentu
    }
});

// --- Inisialisasi Model Gemini ---
console.log("Menginisialisasi model Gemini Pro...");
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// Konfigurasi keamanan (opsional, sesuaikan jika perlu)
const generationConfig = {
    temperature: 0.7,       // Kontrol kreativitas (0.0 - 1.0)
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048, // Batas maksimal token output
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// --- Event Handler Klien WhatsApp ---

// Event ketika QR code diterima
client.on('qr', (qr) => {
    console.log('QR Code diterima, silakan scan dengan WhatsApp Anda:');
    qrcode.generate(qr, { small: true });
});

// Event ketika autentikasi berhasil
client.on('authenticated', () => {
    console.log('Autentikasi berhasil!');
});

// Event ketika autentikasi gagal
client.on('auth_failure', msg => {
    console.error('Kegagalan Autentikasi:', msg);
    console.error('Coba hapus folder "session_data" dan jalankan ulang jika masalah berlanjut.');
});

// Event ketika klien siap digunakan
client.on('ready', () => {
    console.log(`Klien WhatsApp siap! Bot ${BOT_PREFIX ? `dengan prefix "${BOT_PREFIX}" ` : ''}aktif.`);
});

// Event ketika pesan baru diterima
client.on('message', async msg => {
    const contact = await msg.getContact();
    const chat = await msg.getChat();
    const senderName = contact.pushname || contact.name || msg.from; // Nama pengirim

    console.log(`Pesan dari ${senderName} (${msg.from}): "${msg.body}"`);

    // Abaikan pesan dari status, pesan kosong, atau bukan dari chat personal/grup
    if (msg.isStatus || !msg.body || (chat.isGroup && !msg.mentionedIds.includes(client.info.wid._serialized))) {
        // Jika di grup, bot hanya merespons jika di-mention (opsional, bisa diubah)
        if (chat.isGroup && !(msg.body.toLowerCase().startsWith(BOT_PREFIX.toLowerCase()) && msg.mentionedIds.includes(client.info.wid._serialized))) {
            return;
        }
        if (!chat.isGroup && !msg.body.toLowerCase().startsWith(BOT_PREFIX.toLowerCase()) && BOT_PREFIX !== "") {
             return;
        }
    }

    let userMessage = msg.body;

    // Proses pesan jika menggunakan prefix
    if (BOT_PREFIX && userMessage.toLowerCase().startsWith(BOT_PREFIX.toLowerCase())) {
        userMessage = userMessage.substring(BOT_PREFIX.length).trim();
    } else if (BOT_PREFIX) {
        // Jika prefix diset tapi pesan tidak diawali prefix, abaikan (kecuali prefix kosong)
        return;
    }

    if (!userMessage) { // Jika setelah dipotong prefix pesannya jadi kosong
        return;
    }

    console.log(`Memproses prompt untuk Gemini: "${userMessage}"`);
    await chat.sendStateTyping(); // Menampilkan status "mengetik..."

    try {
        // Mengirim prompt ke Gemini
        const parts = [{ text: userMessage }];
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig,
            safetySettings,
        });

        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            const geminiResponse = result.response.candidates[0].content.parts[0].text;
            console.log(`Respons dari Gemini: "${geminiResponse}"`);
            msg.reply(geminiResponse);
        } else {
            console.warn("Tidak ada respons valid dari Gemini.");
            msg.reply("Maaf, saya tidak mendapatkan respons yang valid saat ini.");
        }

    } catch (error) {
        console.error('Error saat berkomunikasi dengan Gemini API:', error.message);
        let errorMessage = "Maaf, terjadi kesalahan saat memproses permintaan Anda ke AI.";
        if (error.message && error.message.includes('SAFETY')) {
            errorMessage = "Maaf, respons diblokir karena alasan keamanan konten.";
        } else if (error.message && error.message.includes('quota')) {
            errorMessage = "Maaf, kuota penggunaan API telah tercapai.";
        }
        msg.reply(errorMessage);
    } finally {
        await chat.clearState(); // Menghapus status "mengetik..."
    }
});

// Event jika terjadi diskoneksi
client.on('disconnected', (reason) => {
    console.log('Klien terdiskoneksi:', reason);
    // Anda mungkin ingin mencoba menginisialisasi ulang klien di sini
    // client.initialize(); // Hati-hati agar tidak terjadi loop tanpa akhir
});


// --- Mulai Klien ---
console.log("Memulai klien WhatsApp...");
client.initialize().catch(err => {
    console.error("Gagal menginisialisasi klien WhatsApp:", err);
});

// --- Penanganan Graceful Shutdown ---
process.on('SIGINT', async () => {
    console.log("\nMenutup koneksi WhatsApp...");
    await client.destroy();
    console.log("Koneksi ditutup. Keluar.");
    process.exit(0);
});
