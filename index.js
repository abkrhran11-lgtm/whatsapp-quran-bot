const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const cron = require("node-cron");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

let currentPairingCode = "جاري التجهيز... يرجى تحديث الصفحة بعد ثوانٍ";
const STATE_FILE = "quran_page.txt";

// خادم ويب لعرض كود الاقتران وإبقاء الخدمة خضراء (Live) على Render
app.get("/", (req, res) => {
    res.send(`
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px; direction: rtl;">
            <h2>👑 البوت الإسلامي للواتساب 👑</h2>
            <p>حالة السيرفر: <b style="color: green;">نشط 24/7</b></p>
            <hr style="width: 50%;">
            <h3>🔐 كود الاقتران الخاص برقمك:</h3>
            <h1 style="color: #25D366; background: #eee; display: inline-block; padding: 10px 20px; border-radius: 8px; letter-spacing: 2px;">
                ${currentPairingCode}
            </h1>
            <p>افتح واتساب > الأجهزة المرتبطة > ربط جهاز > الربط برقم الهاتف > وأدخل هذا الكود.</p>
        </div>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

function getCurrentPage() {
    if (!fs.existsSync(STATE_FILE)) return 1;
    try {
        return parseInt(fs.readFileSync(STATE_FILE, "utf-8").trim()) || 1;
    } catch {
        return 1;
    }
}

function saveCurrentPage(page) {
    fs.writeFileSync(STATE_FILE, page.toString());
}

async function fetchRandomAyah() {
    try {
        const num = Math.floor(Math.random() * 6236) + 1;
        const res = await axios.get(`https://api.alquran.cloud/v1/ayah/${num}/ar.alafasy`, { timeout: 8000 });
        if (res.data?.code === 200) {
            const d = res.data.data;
            return `﴿ ${d.text} ﴾\n\n📖 سورة ${d.surah.name} - الآية ${d.numberInSurah}`;
        }
    } catch {}
    return "﴿ إِنَّ هَذَا الْقُرْآنَ يَهْدِي لِلَّتِي هِيَ أَقْوَمُ ﴾ [الإسراء: 9]";
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome")
    });

    // توليد كود الاقتران عبر متغير البيئة BOT_PHONE
    if (!sock.authState.creds.registered) {
        const phone = process.env.BOT_PHONE || "249118626801"; // رقم البوت بمفتاح الدولة
        await delay(5000);
        try {
            const code = await sock.requestPairingCode(phone);
            currentPairingCode = code;
            console.log(`Pairing Code: ${code}`);
        } catch (err) {
            console.log("Error generating code:", err);
            currentPairingCode = "حدث خطأ، تأكد من صحة الرقم وأعد المحاولة";
        }
    } else {
        currentPairingCode = "✅ تم ربط البوت بنجاح وهو يعمل الآن!";
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            currentPairingCode = "✅ متصل ويعمل في السحاب بنجاح!";
            console.log("Connected to WhatsApp!");
        }
    });

    // استقبال الرسائل
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();

        if (text === "اوامر" || text === "الاوامر" || text === "مساعدة") {
            const menu = `👑 *دليل خدمات البوت الإسلامي* 👑
━━━━━━━━━━━━━━
🔹 *اية* : إرسال آية كريمة بالتشكيل
🔹 *حديث* : إرسال حديث نبوي صحيح
🔹 *دعاء* : إرسال دعاء اليوم
🔹 *صفحة [رقم]* : عرض صورة أي صفحة مصحف (مثال: صفحة 50)
🔹 *ورد اليوم* : إرسال ورد الصفحة الحالية فوراً

صلِّ على الحبيب المصطفى ﷺ`;
            await sock.sendMessage(sender, { text: menu });
        } else if (text === "اية") {
            const ayah = await fetchRandomAyah();
            await sock.sendMessage(sender, { text: ayah });
        } else if (text === "حديث") {
            const hadiths = [
                "قال رسول الله ﷺ: «خَيْرُكُمْ مَنْ تَعَلَّمَ القُرْآنَ وَعَلَّمَهُ». [رواه البخاري]",
                "قال رسول الله ﷺ: «مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا، سَهَّلَ اللهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ». [رواه مسلم]",
                "قال رسول الله ﷺ: «كَلِمَتَانِ خَفِيفَتَانِ عَلَى اللِّسَانِ، ثَقِيلَتَانِ فِي المِيزَانِ: سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ العَظِيمِ». [متفق عليه]"
            ];
            const h = hadiths[Math.floor(Math.random() * hadiths.length)];
            await sock.sendMessage(sender, { text: `💎 *حديث نبوي:*\n\n${h}` });
        } else if (text === "دعاء") {
            await sock.sendMessage(sender, { text: "🤲 اللهم إنا نسألك من الخير كله عاجله وآجله، ما علمنا منه وما لم نعلم." });
        } else if (text.startsWith("صفحة ")) {
            const num = parseInt(text.split(" ")[1]);
            if (num >= 1 && num <= 604) {
                const str = String(num).padStart(3, "0");
                await sock.sendMessage(sender, {
                    image: { url: `https://everyayah.com/data/quranpngs/${str}.png` },
                    caption: `📖 المصحف الشريف | صفحة (${num})`
                });
            } else {
                await sock.sendMessage(sender, { text: "⚠️ يرجى تحديد صفحة بين 1 و 604." });
            }
        } else if (text === "ورد اليوم") {
            const page = getCurrentPage();
            const str = String(page).padStart(3, "0");
            await sock.sendMessage(sender, {
                image: { url: `https://everyayah.com/data/quranpngs/${str}.png` },
                caption: `📖 *ورد اليوم المبارك | الصفحة (${page})*`
            });
        }
    });

    // النشر التلقائي اليومي (الساعة 6:30 صباحاً)
    cron.schedule("30 6 * * *", async () => {
        const page = getCurrentPage();
        const str = String(page).padStart(3, "0");
        const url = `https://everyayah.com/data/quranpngs/${str}.png`;
        const ayah = await fetchRandomAyah();

        const caption = `👑 *ورد اليوم المبارك | الصفحة (${page})* 👑\n━━━━━━━━━━━━━━\n\n${ayah}\n\nاللهم اجعل القرآن ربيع قلوبنا.`;
        
        // إذا أردت إرساله لرقمك الشخصي تلقائياً:
        // await sock.sendMessage("249118626801@s.whatsapp.net", { image: { url }, caption });

        const next = page < 604 ? page + 1 : 1;
        saveCurrentPage(next);
    });
}

startBot();
