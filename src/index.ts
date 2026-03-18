import express from "express";
import cron from "node-cron";
import db from "./db.js";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sendTelegramMessage = async (text: string) => {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    }
  );
  const data = await res.json();
  console.log("Telegram:", data.ok ? "sent" : data.description);
};

app.get("/bp", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ضغط الدم</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-950 text-slate-200 font-sans flex items-center justify-center min-h-screen">
      <div class="bg-slate-800 p-8 rounded-2xl w-80 shadow-lg">
        <h1 class="text-xl font-semibold text-center mb-6">🩺 ضغط الدم</h1>
        <label class="block text-sm text-slate-400 mb-1">الانقباضي (العالي)</label>
        <input type="number" id="systolic" placeholder="120" inputmode="numeric"
          class="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-slate-200 text-xl text-center mb-4 outline-none focus:border-blue-500 transition" dir="ltr">
        <label class="block text-sm text-slate-400 mb-1">الانبساطي (الواطي)</label>
        <input type="number" id="diastolic" placeholder="80" inputmode="numeric"
          class="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-slate-200 text-xl text-center mb-4 outline-none focus:border-blue-500 transition" dir="ltr">
        <label class="block text-sm text-slate-400 mb-1">النبض</label>
        <input type="number" id="pulse" placeholder="72" inputmode="numeric"
          class="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-slate-200 text-xl text-center mb-6 outline-none focus:border-blue-500 transition" dir="ltr">
        <button onclick="submit()"
          class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition active:scale-95">
          حفظ
        </button>
        <p id="msg" class="text-center text-green-400 mt-4 hidden">تم الحفظ ✓</p>
      </div>
      <script>
        async function submit() {
          const systolic = document.getElementById('systolic').value;
          const diastolic = document.getElementById('diastolic').value;
          const pulse = document.getElementById('pulse').value;
          if (!systolic || !diastolic) return;
          const res = await fetch('/bp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systolic: +systolic, diastolic: +diastolic, pulse: pulse ? +pulse : null })
          });
          if (res.ok) {
            document.getElementById('msg').classList.remove('hidden');
            document.getElementById('systolic').value = '';
            document.getElementById('diastolic').value = '';
            document.getElementById('pulse').value = '';
            setTimeout(() => document.getElementById('msg').classList.add('hidden'), 3000);
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/analytics", async (_req, res) => {
  const readings = await db.bloodPressure.findMany({
    orderBy: { createdAt: "asc" },
  });

  const avg = readings.length
    ? {
      systolic: Math.round(readings.reduce((s, r) => s + r.systolic, 0) / readings.length),
      diastolic: Math.round(readings.reduce((s, r) => s + r.diastolic, 0) / readings.length),
      pulse: Math.round(readings.filter((r) => r.pulse).reduce((s, r) => s + (r.pulse || 0), 0) / (readings.filter((r) => r.pulse).length || 1)),
    }
    : { systolic: 0, diastolic: 0, pulse: 0 };

  const sColor = avg.systolic > 140 ? "text-red-400" : avg.systolic > 120 ? "text-yellow-400" : "text-green-400";
  const dColor = avg.diastolic > 90 ? "text-red-400" : avg.diastolic > 80 ? "text-yellow-400" : "text-green-400";

  // Group readings by day
  const days: Record<string, typeof readings> = {};
  readings.forEach((r) => {
    const key = new Date(r.createdAt).toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" });
    if (!days[key]) days[key] = [];
    days[key].push(r);
  });

  const dayRows = Object.entries(days)
    .reverse()
    .map(([day, rds]) => {
      const cells = rds
        .map((r) => {
          const time = new Date(r.createdAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
          const s = r.systolic;
          const d = r.diastolic;
          const color = s > 140 || d > 90 ? "text-red-400" : s > 120 || d > 80 ? "text-yellow-400" : "text-green-400";
          return `<div class="flex flex-col items-center gap-0.5" id="cell-${r.id}">
            <span class="text-xs text-slate-500">${time}</span>
            <span class="font-mono font-bold text-lg ${color}">${s}/${d}</span>
            ${r.pulse ? `<span class="text-xs text-slate-500">♥ ${r.pulse}</span>` : ""}
            <button onclick="del('${r.id}')" class="delete-col hidden text-[10px] text-red-400 hover:text-red-300 mt-0.5">حذف</button>
          </div>`;
        })
        .join("");

      return `<div class="border-b border-slate-700/50 py-3 px-4">
        <div class="text-sm text-slate-400 mb-2">${day}</div>
        <div class="flex gap-6 flex-wrap">${cells}</div>
      </div>`;
    })
    .join("");

  const chartData = readings.map((r) => ({
    label:
      new Date(r.createdAt).toLocaleDateString("ar-IQ", { day: "numeric", month: "numeric" }) +
      " " +
      new Date(r.createdAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" }),
    systolic: r.systolic,
    diastolic: r.diastolic,
    pulse: r.pulse,
  }));

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>تقرير ضغط الدم</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    </head>
    <body class="bg-slate-950 text-slate-200 font-sans min-h-screen">
      <div class="max-w-md mx-auto px-4 py-6">

        <div class="flex items-center justify-between mb-4">
          <h1 class="text-lg font-bold">🩺 ضغط الدم</h1>
          <div class="relative">
            <button onclick="document.getElementById('menu').classList.toggle('hidden')"
              class="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-lg transition">⋮</button>
            <div id="menu" class="hidden absolute left-0 top-11 bg-slate-800 border border-slate-700 rounded-xl p-4 w-56 z-50 shadow-xl space-y-3">
              <div class="text-xs text-slate-400">المعدلات</div>
              <div class="flex justify-between text-sm"><span>الانقباضي</span><span class="font-mono font-bold ${sColor}">${avg.systolic}</span></div>
              <div class="flex justify-between text-sm"><span>الانبساطي</span><span class="font-mono font-bold ${dColor}">${avg.diastolic}</span></div>
              <div class="flex justify-between text-sm"><span>النبض</span><span class="font-mono font-bold">${avg.pulse}</span></div>
              <div class="flex justify-between text-sm"><span>القراءات</span><span class="font-mono font-bold">${readings.length}</span></div>
              <hr class="border-slate-700">
              <button onclick="toggleDelete()" class="w-full text-sm text-center py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition" id="editBtn">🗑️ تعديل</button>
              <button onclick="window.print()" class="w-full text-sm text-center py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition">🖨️ طباعة</button>
              <a href="/bp" class="block text-sm text-center py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition">+ قراءة جديدة</a>
            </div>
          </div>
        </div>

        <!-- Daily readings -->
        <div class="bg-slate-800 rounded-xl overflow-hidden mb-6">
          ${dayRows || '<div class="py-8 text-center text-slate-500 text-sm">لا توجد قراءات</div>'}
        </div>

        <!-- Chart -->
        <div class="bg-slate-800 rounded-xl p-4">
          <canvas id="chart" height="180"></canvas>
        </div>

      </div>

      <script>
        document.addEventListener('click', (e) => {
          if (!e.target.closest('.relative')) document.getElementById('menu').classList.add('hidden');
        });

        let editing = false;
        function toggleDelete() {
          editing = !editing;
          document.querySelectorAll('.delete-col').forEach(el => el.classList.toggle('hidden', !editing));
          document.getElementById('editBtn').textContent = editing ? '✓ تم' : '🗑️ تعديل';
          document.getElementById('menu').classList.add('hidden');
        }

        async function del(id) {
          if (!confirm('حذف؟')) return;
          const res = await fetch('/bp/' + id, { method: 'DELETE' });
          if (res.ok) document.getElementById('cell-' + id).remove();
        }

        const data = ${JSON.stringify(chartData)};
        if (data.length) {
          new Chart(document.getElementById('chart'), {
            type: 'line',
            data: {
              labels: data.map(d => d.label),
              datasets: [
                {
                  label: 'الانقباضي',
                  data: data.map(d => d.systolic),
                  borderColor: '#f87171',
                  backgroundColor: 'rgba(248,113,113,0.08)',
                  fill: true, tension: 0.35, pointRadius: 4,
                  pointBackgroundColor: '#f87171', borderWidth: 2,
                },
                {
                  label: 'الانبساطي',
                  data: data.map(d => d.diastolic),
                  borderColor: '#60a5fa',
                  backgroundColor: 'rgba(96,165,250,0.08)',
                  fill: true, tension: 0.35, pointRadius: 4,
                  pointBackgroundColor: '#60a5fa', borderWidth: 2,
                },
                {
                  label: 'النبض',
                  data: data.map(d => d.pulse),
                  borderColor: '#a78bfa',
                  fill: false, tension: 0.35, pointRadius: 3,
                  pointBackgroundColor: '#a78bfa', borderWidth: 1.5,
                  borderDash: [4, 4],
                }
              ]
            },
            options: {
              responsive: true,
              interaction: { intersect: false, mode: 'index' },
              plugins: {
                legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
                tooltip: { backgroundColor: '#1e293b', titleColor: '#e2e8f0', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1, rtl: true }
              },
              scales: {
                x: { ticks: { color: '#64748b', maxRotation: 45, font: { size: 9 } }, grid: { color: '#1e293b' } },
                y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, suggestedMin: 50, suggestedMax: 180 }
              }
            }
          });
        }
      </script>
    </body>
    </html>
  `);
});

app.post("/bp", async (req, res) => {
  const { systolic, diastolic, pulse } = req.body;
  if (!systolic || !diastolic) return res.status(400).json({ error: "Missing fields" });

  const record = await db.bloodPressure.create({
    data: { systolic, diastolic, pulse: pulse || null },
  });

  res.json(record);
});

app.delete("/bp/:id", async (req, res) => {
  await db.bloodPressure.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

cron.schedule("0 9,17,21 * * *", () => {
  const now = new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
  sendTelegramMessage(
    `🩺 <b>تذكير ضغط الدم</b>\n🕐 ${now}\n\nوقت تسجيل ضغط الدم!\n\n👉 <a href="${process.env.APP_URL}/bp">سجّل الآن</a>\n📊 <a href="${process.env.APP_URL}/analytics">التقرير</a>`
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const now = new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
  sendTelegramMessage(
    `✅ <b>السيرفر شغال</b>\n🕐 ${now}\n\nتطبيق ضغط الدم جاهز.\nالتنبيهات: 9 صباحاً، 5 عصراً، 9 مساءً\n\n👉 <a href="${process.env.APP_URL}/bp">سجّل الآن</a>\n📊 <a href="${process.env.APP_URL}/analytics">التقرير</a>`
  );
});
