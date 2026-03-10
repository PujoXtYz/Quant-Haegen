# 📦 Bybit → Custom GPT Middleware

## 🗂 File yang Ada
- `server.js` → Server utama
- `package.json` → Dependencies
- `openapi-schema.yaml` → Schema untuk Custom GPT

---

## 🚀 LANGKAH DEPLOY KE RAILWAY (Gratis)

### 1. Buat akun Railway
- Buka https://railway.app dan login pakai GitHub

### 2. Upload ke GitHub dulu
- Buat repo baru di https://github.com/new (nama bebas, contoh: bybit-middleware)
- Upload ketiga file ini ke repo tersebut

### 3. Deploy di Railway
- Buka https://railway.app/new
- Pilih "Deploy from GitHub repo"
- Pilih repo yang baru dibuat
- Klik Deploy

### 4. Set Environment Variables di Railway
Setelah deploy, masuk ke Settings → Variables, tambahkan:

| Variable Name     | Value                        |
|-------------------|------------------------------|
| BYBIT_API_KEY     | (API Key Bybit kamu)         |
| BYBIT_API_SECRET  | (API Secret Bybit kamu)      |
| MIDDLEWARE_KEY    | (Password bebas, contoh: mySecretPass123) |
| PORT              | 3000                         |

⚠️ JANGAN taruh API key langsung di server.js!

### 5. Dapatkan URL Railway kamu
- Masuk ke Settings → Networking → Generate Domain
- URL akan seperti: https://bybit-middleware-xxxx.railway.app

---

## 🤖 SETTING DI CUSTOM GPT

### A. Pasang Schema
1. Buka Custom GPT → Edit → Actions → Create new action
2. Copy isi `openapi-schema.yaml`
3. Ganti `https://YOUR-APP-NAME.railway.app` dengan URL Railway kamu
4. Paste ke kolom Schema

### B. Set Authentication
1. Authentication Type → **API Key**
2. API Key → isi dengan nilai MIDDLEWARE_KEY yang kamu set di Railway
3. Auth Type → **Custom**
4. Custom Header Name → `X-Api-Key`
5. Klik Save

---

## 💬 CONTOH PERTANYAAN KE GPT

Setelah setup selesai, kamu bisa tanya:
- "Berapa saldo wallet Bybit aku?"
- "Tampilkan posisi futures yang sedang buka"
- "Berapa harga BTCUSDT sekarang?"
- "Tampilkan 10 order terakhir ETHUSDT"
- "Ada open order apa saja sekarang?"

---

## ⚠️ PENTING - KEAMANAN API BYBIT

Pastikan di Bybit API settings:
- ✅ Read-Only permission (kalau hanya ingin lihat data)
- ✅ IP Whitelist diisi IP Railway (opsional tapi lebih aman)
- ❌ Jangan aktifkan permission Withdraw!
