# AzerClaw - AI Agent İdarəetmə Sistemi

![AzerClaw Logo](public/logo/logo.jfif)

![AzerClaw](https://img.shields.io/badge/version-1.0.0-blue)
![Node.js](https://img.shields.io/badge/node.js-18%2B-green)
![License](https://img.shields.io/badge/license-MIT-orange)

## 🎯 Layihə Haqqında

**AzerClaw** - güclü və genişləndirilə bilən AI Agent İdarəetmə Sistemi. Google Live API, Google Gemini və Ollama kimi müxtəlif AI modellərini dəstəkləyir. Real vaxt rejimində səsli kommunikasiya, zamanlanmış tapşırıqlar, plugin sistemi və daha çox xüsusiyyətləri təklif edir.

### 👨‍💻 Yaradıcı və İnkişaf Etdirici

Bu layihə **Qadir Abbasov** tərəfindən yaradılmış və inkişaf etdirilmişdir.

---

## ✨ Xüsusiyyətlər

### 🤖 AI Modelləri
- **Google Live API** - Real vaxt səsli kommunikasiya
- **Google Gemini** - Mətn əsaslı AI cavabları
- **Ollama** - Yerli AI modelləri (qwen3, llama, və s.)

### 🎙️ Səsli Kommunikasiya
- Real vaxt səsli giriş və çıxış
- Mikrofon inteqrasiyası
- Google Live ilə canlı səsli bağlantı
- Web Speech API dəstəyi

### ⏰ Zamanlanmış Tapşırıqlar
- Cron ifadələri ilə avtomatik tapşırıqlar
- Agentlər üçün zamanlanmış mesajlar
- Tapşırıq idarəetmə paneli

### 🔌 Plugin Sistemi
- ZIP faylları ilə plugin yükləmə
- GUI dəstəyi olan pluginlər
- Dinamik plugin yüklənməsi
- Plugin asılılıqları idarəetməsi

### 🌐 Web İnterfeysi
- Modern və cavabdeh dizayn
- Real vaxt Socket.IO bağlantısı
- Çoxlu dil dəstəyi (Türkçe, Azərbaycan, English)
- Dark mode
- Mobil uyğunluq

### 🔧 Sistem İdarəetməsi
- Server ayarları konfiqurasiyası
- API açarları idarəetməsi
- Avtomatik yeniləmə

### 📊 Agent İdarəetməsi
- Birdən çox agent yaradılması
- Agent üçün fərdi promptlar
- Tool seçimi və konfiqurasiyası
- Agent tarixçəsi idarəetməsi
- Agent status izləməsi

---

## 📦 Quraşdırma

### Tələblər
- **Node.js** v18.0 və ya daha yüksək
- **npm** v9.0 və ya daha yüksək
- **Git** (ixtiyari)

### Addım-addım quraşdırma

#### 1. Layihəni klonlaşdırın

```bash
git clone https://github.com/QadirAbbasov-Official/AzerClaw.git
cd AzerClaw
```

#### 2. Asılılıqları yükləyin

```bash
npm install
```

#### 3. Konfiqurasiya

Server başladıqdan sonra web arayüzündən konfiqurasiya edə bilərsiniz:

1. Brauzerinizdə `http://localhost:3000` ünvanına daxil olun
2. **Tənzimləmələr** (Settings) tab-ına keçin
3. **API Açarları** hissəsində Google və Gemini API açarlarını əlavə edin
4. **Server Tənzimləmələri** hissəsində port və host dəyişiklikləri edə bilərsiniz

#### 4. Serveri başladın

**Development (İnkişaf etdirmə) modu:**
```bash
npm run dev
```
və ya
```bash
node server.js
```

**Production (İstehsal) modu:**
```bash
npm start
```
və ya
```bash
node safe-start.js
```

Server `http://localhost:3000` ünvanında başlayacaq.

---

### PM2 ilə İstifadə (Production)

**PM2 ilə başlatma:**
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

**PM2 ilə dayandırma:**
```bash
pm2 stop azerclaw
pm2 delete azerclaw
```

**PM2 komandaları:**
```bash
pm2 logs azerclaw        # Logları göstər
pm2 monit                # Monitorü aç
pm2 restart azerclaw     # Yenidən başlat
pm2 status               # Durumu göstər
```

---

## 🚀 İstifadə

### Web İnterfeysi

1. Brauzerinizdə `http://localhost:3000` ünvanına daxil olun
2. **Yeni Agent** düyməsini sıxın
3. Agent adı, prompt və model seçin
4. **Yarat** düyməsini sıxın
5. Agenti seçin və **Başlat** düyməsini sıxın

### Agent Yaratmaq

1. Sol paneldə **+ Yeni Agent** düyməsini sıxın
2. Formu doldurun:
   - **Agent Adı**: Agent üçün ad
   - **Sistem Promptu**: Agentin davranışını təyin edin
   - **Model**: İstifadə ediləcək AI modeli
   - **Tool Seçimi**: Agentin istifadə edə biləcəyi tool-ları
3. **Yarat** düyməsini sıxın

### Zamanlanmış Tapşırıq Yaratmaq

1. **Zamanlanmış Tapşırıqlar** tab-ına keçin
2. **+** düyməsini sıxın
3. Formu doldurun:
   - **Tapşırıq Adı**: Tapşırığın adı
   - **Agent Seç**: Tapşırığı icra edəcək agent
   - **Cron İfadesi**: Zaman cədvəli (məsələn: `0 9 * * *` - hər gün saat 09:00)
   - **Mesaj**: Agentə göndəriləcək mesaj
4. **Yarat** düyməsini sıxın

### Plugin Yükləmək

1. **Pluginlər** tab-ına keçin
2. **Plugin Yüklə** düyməsini sıxın
3. `.zip` formatında plugin faylı seçin
4. Plugin avtomatik olaraq yüklənəcək

### Səsli Kommunikasiya

Google Live modelini seçdiyinizdə:
- **Canlı Səsli Qoşul** düyməsi görünəcək
- Düyməni sıxın və mikrofon icazəsi verin
- Agentlə real vaxtda səsli danışa bilərsiniz

---

## 📁 Layihə Strukturu

```
AzerClaw/
├── public/                 # Frontend faylları
│   ├── index.html         # Ana HTML səhifə
│   ├── app.js             # Frontend JavaScript
│   ├── lang.js            # Dil tərcümələri
│   └── styles.css         # CSS stillər
├── src/                   # Backend mənbə kodu
│   ├── agents/            # Agent sinifləri
│   │   ├── Agent.js
│   │   └── AgentManager.js
│   ├── config/            # Konfiqurasiya
│   │   ├── config.js
│   │   └── lang.js
│   ├── cron/              # Zamanlanmış tapşırıqlar
│   │   ├── CronManager.js
│   │   └── CronTask.js
│   ├── models/            # Modellər
│   │   ├── ModelManager.js
│   │   ├── google/
│   │   │   ├── GoogleLive.js
│   │   │   └── GoogleLLM.js
│   │   └── ollama/
│   │       └── OllamaAgent.js
│   ├── system/            # Sistem komponentləri
│   │   └── UpdateManager.js
│   ├── storage/           # Saxlama
│   │   └── DataManager.js
│   └── tools/             # Tool-lar
│       ├── PluginManager.js
│       └── ToolManager.js
├── plugins/               # Pluginlər (boş - istifadəçi plugin yükləyə bilər)
├── data/                  # Məlumatlar
│   ├── agents/
│   ├── config/
│   └── models/
├── logs/                  # Log faylları
├── downloads/             # Yüklənmiş fayllar
├── server.js              # Ana server faylı
├── package.json           # Node.js asılılıqları
└── README.md              # Bu fayl
```

---

## 🔌 Plugin Sistemi

AzerClaw geniş plugin sistemi təklif edir. Pluginlər aşağıdakı funksionallığı təmin edə bilər:

### Plugin Strukturu

```
plugin-name/
├── main.js           # Ana plugin kodu
├── info.json         # Plugin məlumatları
└── gui/              # İxtiyari GUI
    ├── gui.js
    ├── gui.css
    └── lang.js
```

### info.json Nümunəsi

```json
{
    "name": "Plugin Adı",
    "version": "1.0.0",
    "description": "Plugin təsviri",
    "author": "Qadir Abbasov",
    "category": "category",
    "dependencies": [],
    "gui": true
}
```

### Plugin Yükləmə

İstifadəçilər plugin yükləmə sistemi ilə yeni pluginlər əlavə edə bilərlər.

---

## 🌍 Dil Dəstəyi

AzerClaw çoxlu dil dəstəyi təklif edir:

- 🇹🇷 **Türkçe**
- 🇦🇿 **Azərbaycan**
- 🇬🇧 **English**

Dil dəyişdirmək üçün: **Tənzimləmələr** → **Dil Ayarları** → Dil seçin.

---

## 🔧 API Açarları

### Google API Key

1. [Google Cloud Console](https://console.cloud.google.com/) açın
2. Yeni layihə yaradın
3. Generative AI API-ni aktivləşdirin
4. API açarı yaradın
5. Açarı konfiqurasiyaya əlavə edin

### Gemini API Key

1. [Google AI Studio](https://aistudio.google.com/) açın
2. API açarı yaradın
3. Açarı konfiqurasiyaya əlavə edin

---

## 🔄 Yeniləmə

AzerClaw avtomatik yeniləmə dəstəyi təklif edir:

1. **Tənzimləmələr** → **Yeniləmə Tənzimləmələri** açın
2. **Başlanğıcda Yeniləmə Yoxlaması** aktivləşdirin
3. **Yeniləmə Yoxlama Aralığı** təyin edin
4. **Avtomatik Yeniləmə** aktivləşdirin

> **Qeyd:** Yeniləmələr rəsmi `QadirAbbasov-Official` GitHub repozitoriyası üzərindən avtomatik təmin edilir.

---

## 🐛 Troubleshooting

### Server başlamır

```bash
# Port istifadə olunub yoxlanın
netstat -ano | findstr :3000

# Log fayllarını yoxlayın
cat logs/error.log
```

### Agent cavab vermir

- API açarlarının düzgün təyin edildiyini yoxlayın
- İnternet bağlantısını yoxlayın
- Model konfiqurasiyasını yoxlayın

### Səsli mikrofon işləmir

- Brauzer mikrofon icazəsi verin
- HTTPS istifadə edin (yüksək təhlükəsizlik üçün)
- Web Speech API dəstəyini yoxlayın

---

## 🤝 İştirak

İştirak etmək istəyirsinizsə:

1. Fork edin
2. Feature branch yaradın (`git checkout -b feature/AmazingFeature`)
3. Dəyişiklikləri commit edin (`git commit -m 'Add some AmazingFeature'`)
4. Branch-e push edin (`git push origin feature/AmazingFeature`)
5. Pull Request açın

---

## 📞 Dəstək

### GitHub Issues
[GitHub Issues](https://github.com/QadirAbbasov-Official/AzerClaw/issues) vasitəsilə xəta bildirin və ya təklif verin.

### Dəstək
Xəta bildirmək və ya təklif vermək üçün GitHub Issues istifadə edin.

---

## 📄 Lisenziya

Bu layihə [MIT License](LICENSE) altında lisenziyalanmışdır.

---

## 🙏 Təşəkkürlər

- Google Generative AI komandası
- Node.js cəmiyyəti
- Socket.io komandası
- Bütün iştirakçılar

---

## 📊 Statistika

![GitHub Stars](https://img.shields.io/github/stars/QadirAbbasov-Official/AzerClaw?style=social)
![GitHub Forks](https://img.shields.io/github/forks/QadirAbbasov-Official/AzerClaw?style=social)
![GitHub Issues](https://img.shields.io/github/issues/QadirAbbasov-Official/AzerClaw)
![GitHub License](https://img.shields.io/github/license/QadirAbbasov-Official/AzerClaw)

---

## 🔮 Gələcək Planlar

- [ ] Daha çox AI model dəstəyi
- [ ] Mobil tətbiq
- [ ] REST API sənədləşməsi
- [ ] Docker dəstəyi
- [ ] Cloud tərtibat
- [ ] Agent marketi

---

**AzerClaw** - AI Agent İdarəetmə Sistemi

© 2026 Qadir Abbasov. Bütün hüquqlar qorunur.
