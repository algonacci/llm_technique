## ON/OFF Reasoning Page

Halaman **ON/OFF Reasoning** mendemonstrasikan bagaimana mengonsumsi model LLM secara streaming dengan kontrol penuh terhadap tampilan _chain-of-thought_ (`<think>...</think>`) di sisi klien. Fitur ini memungkinkan pengguna untuk melihat proses berpikir model atau hanya melihat hasil akhir sesuai kebutuhan.

---

## Daftar Isi

- [Arsitektur Sistem](#arsitektur-sistem)
- [Alur Data Streaming](#alur-data-streaming)
- [Komponen Frontend](#komponen-frontend)
- [Komponen Backend](#komponen-backend)
- [Perilaku UI Detail](#perilaku-ui-detail)
- [Konfigurasi Environment](#konfigurasi-environment)
- [Pengujian Manual](#pengujian-manual)
- [Troubleshooting](#troubleshooting)
- [Pengembangan Lanjutan](#pengembangan-lanjutan)

---

## Arsitektur Sistem

### Stack Teknologi

| Komponen | Teknologi | Versi | Peran |
| --- | --- | --- | --- |
| **Runtime** | Node.js | - | Server-side JavaScript runtime |
| **Framework** | Express.js | 5.1.0 | Web server dan routing |
| **Template Engine** | Nunjucks | 3.2.4 | Server-side rendering untuk HTML |
| **LLM Client** | OpenAI SDK | 6.6.0 | HTTP client untuk komunikasi dengan model LLM |
| **Markdown Parser** | Marked.js | latest (CDN) | Client-side markdown-to-HTML converter |
| **Environment** | dotenv | 17.2.3 | Manajemen variabel environment |

### Arsitektur File

```
llm_technique/
├── server.js                          # Backend entry point
├── views/
│   ├── layout.njk                     # Template dasar dengan styling
│   ├── on_off_reasoning.njk           # Halaman ON/OFF Reasoning
│   └── home.njk                       # Landing page
├── .env                               # Konfigurasi environment
└── package.json                       # Dependencies
```

### Diagram Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Client)                      │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  on_off_reasoning.njk                                  │ │
│  │  ├─ Form (prompt input + toggle)                       │ │
│  │  ├─ EventSource (SSE client)                           │ │
│  │  ├─ Rendering logic (parsing <think> tags)             │ │
│  │  └─ Markdown renderer (marked.js)                      │ │
│  └────────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP/SSE
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    Express Server (server.js)                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  GET /on_off_reasoning → render template              │ │
│  │  GET /api/reasoning → streamResponse handler          │ │
│  │    ├─ Validasi prompt & env vars                      │ │
│  │    ├─ Set SSE headers                                 │ │
│  │    ├─ Kirim event 'config'                            │ │
│  │    └─ Stream delta tokens via event 'message'         │ │
│  └────────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTPS
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                  LLM API (via OpenAI SDK)                    │
│  Endpoint: LLM_BASE_URL                                      │
│  Auth: LLM_API_KEY                                           │
│  Model: LLM_MODEL_NAME (default: gpt-4o-mini)                │
│  Streaming: true                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Alur Data Streaming

### 1. Inisialisasi Request (Client → Server)

**File:** `views/on_off_reasoning.njk` (baris 121-141)

```javascript
// User submit form
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();

  // Buat URL dengan query parameters
  const params = new URLSearchParams({
    prompt,
    reasoning: reasoningToggle.checked ? 'on' : 'off',
  });
  const url = `/api/reasoning?${params.toString()}`;

  // Buka koneksi SSE
  source = new EventSource(url);
});
```

### 2. Validasi dan Konfigurasi (Server)

**File:** `server.js` (baris 45-77)

```javascript
const streamResponse = async (req, res) => {
  const prompt = req.query.prompt;
  const reasoningMode = req.query.reasoning === 'off' ? 'off' : 'on';

  // Validasi
  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }
  if (!process.env.LLM_API_KEY || !process.env.LLM_BASE_URL) {
    res.status(500).json({ error: 'LLM belum dikonfigurasi.' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Kirim konfigurasi awal
  sendEvent('config', { reasoningMode, source: req.path });
};
```

### 3. System Prompt Adaptation

**File:** `server.js` (baris 79-82)

Berdasarkan mode reasoning, server menyesuaikan system prompt:

```javascript
const systemPrompt = reasoningMode === 'off'
  ? 'You are a helpful assistant. Respond directly to the user without revealing your chain-of-thought. Do not generate <think> tags.'
  : 'You are a helpful assistant. You may think through the task and include your reasoning inside <think>...</think> before the final answer.';
```

### 4. Streaming dari LLM API

**File:** `server.js` (baris 84-102)

```javascript
const stream = await openai.chat.completions.create({
  model: process.env.LLM_MODEL_NAME || 'gpt-4o-mini',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ],
  max_tokens: Number(process.env.LLM_MAX_TOKENS) || 4096,
  stream: true,
});

// Stream setiap delta token ke client
for await (const part of stream) {
  const text = part.choices?.[0]?.delta?.content || '';
  if (text) {
    sendEvent('message', { text });
  }
}

sendEvent('end', {});
```

### 5. Client-Side Buffer dan Parsing

**File:** `views/on_off_reasoning.njk` (baris 143-153)

```javascript
source.addEventListener('message', (messageEvent) => {
  try {
    const payload = JSON.parse(messageEvent.data);
    if (payload.text) {
      buffer += payload.text;  // Akumulasi token
      renderWithMarked(buffer);  // Re-render UI
    }
  } catch (error) {
    console.error('Gagal mem-parsing streaming:', error);
  }
});
```

### Diagram Sequence

```
Client                 Server                    LLM API
  │                      │                          │
  │──[1] POST form──────>│                          │
  │    ?prompt=...       │                          │
  │    &reasoning=on     │                          │
  │                      │                          │
  │                      │──[2] Validasi prompt     │
  │                      │                          │
  │<─[3] SSE Headers─────│                          │
  │                      │                          │
  │<─[4] event:config────│                          │
  │    {reasoningMode}   │                          │
  │                      │                          │
  │                      │──[5] Stream request─────>│
  │                      │    {systemPrompt+prompt} │
  │                      │                          │
  │<─[6] event:message───│<─[6a] delta token 1──────│
  │    {text: "Think"}   │                          │
  │                      │                          │
  │<─[7] event:message───│<─[7a] delta token 2──────│
  │    {text: "ing..."}  │                          │
  │                      │                          │
  │      ... (loop) ...  │      ... (loop) ...      │
  │                      │                          │
  │<─[8] event:end───────│<─[8a] stream complete────│
  │                      │                          │
  │                      │──[9] res.end()           │
```

---

## Komponen Frontend

### 1. Form Input

**File:** `views/on_off_reasoning.njk` (baris 9-27)

```html
<form id="reasoning-form" class="reasoning-form">
  <!-- Textarea untuk prompt -->
  <div class="field">
    <label for="prompt-input">Masukkan prompt:</label>
    <textarea id="prompt-input" name="prompt" rows="6"
              placeholder="Tuliskan instruksi untuk model reasoning di sini..."
              required></textarea>
  </div>

  <!-- Toggle switch -->
  <div class="toggle">
    <span class="toggle-label">Reasoning</span>
    <label class="switch">
      <input type="checkbox" id="reasoning-toggle" name="reasoning" checked />
      <span class="slider"></span>
    </label>
    <span id="reasoning-state" class="toggle-state">ON</span>
  </div>

  <!-- Action buttons -->
  <div class="actions">
    <button type="submit">Kirim ke Model</button>
    <button type="button" id="reasoning-stop" class="button-secondary" disabled>Stop</button>
    <span id="status" class="status-text"></span>
  </div>
</form>
```

### 2. Rendering Logic

**File:** `views/on_off_reasoning.njk` (baris 67-119)

Fungsi `renderWithMarked` adalah jantung dari rendering UI:

```javascript
const renderWithMarked = (text) => {
  // [1] Deteksi tag <think>
  const thinkStart = text.indexOf('<think>');
  const thinkEnd = text.indexOf('</think>');
  const hasReasoning = thinkStart !== -1;
  const reasoningComplete = thinkEnd !== -1;

  // [2] Jika toggle OFF dan reasoning belum selesai, sembunyikan output
  if (!reasoningToggle.checked && hasReasoning && !reasoningComplete) {
    output.innerHTML = '';
    return;
  }

  // [3] Pisahkan konten reasoning dan jawaban
  let reasoningContent = '';
  let answerContent = text;

  if (hasReasoning) {
    const startIndex = thinkStart + '<think>'.length;
    const endIndex = reasoningComplete ? thinkEnd : text.length;
    reasoningContent = text.slice(startIndex, endIndex);

    const prefixContent = text.slice(0, thinkStart);
    const suffixContent = reasoningComplete ? text.slice(thinkEnd + '</think>'.length) : '';
    answerContent = reasoningComplete ? `${prefixContent}${suffixContent}` : prefixContent;
  }

  // [4] Render reasoning block (jika toggle ON)
  let html = '';
  if (reasoningToggle.checked && hasReasoning) {
    const trimmed = reasoningContent.trim();
    const thinkingHtml = trimmed
      ? formatThinking(reasoningContent)
      : '<em>Model is thinking…</em>';

    html += `
      <details class="think-block ${reasoningComplete ? 'think-complete' : ''}"
               ${reasoningComplete ? '' : 'open'}>
        <summary>Model reasoning</summary>
        <div>${thinkingHtml}${reasoningComplete ? '' : '<span class="stream-caret"></span>'}</div>
      </details>
    `;
  }

  // [5] Render jawaban akhir (parsed dengan marked.js)
  const shouldShowAnswer =
    !hasReasoning ||
    reasoningComplete ||
    (!reasoningToggle.checked && !hasReasoning);

  if (shouldShowAnswer && answerContent.trim()) {
    html += marked.parse(answerContent);
  } else if (!hasReasoning && text.trim()) {
    html += marked.parse(text);
  }

  output.innerHTML = html;
};
```

### 3. Event Handlers

**Event: `config`** (baris 162-171)
```javascript
source.addEventListener('config', (configEvent) => {
  const payload = JSON.parse(configEvent.data);
  status.textContent = payload.reasoningMode === 'on'
    ? 'Streaming dimulai (Reasoning ON)'
    : 'Streaming dimulai (Reasoning OFF)';
});
```

**Event: `end`** (baris 155-160)
```javascript
source.addEventListener('end', () => {
  status.textContent = 'Streaming selesai.';
  submitButton.disabled = false;
  stopButton.disabled = true;
  closeSource();
});
```

**Event: `error`** (baris 173-189)
```javascript
source.addEventListener('error', (errorEvent) => {
  submitButton.disabled = false;
  stopButton.disabled = true;

  if (errorEvent.data) {
    const payload = JSON.parse(errorEvent.data);
    status.textContent = payload.message || 'Terjadi kesalahan.';
  } else {
    status.textContent = 'Koneksi streaming terputus.';
  }

  closeSource();
});
```

### 4. Toggle State Management

**File:** `views/on_off_reasoning.njk` (baris 200-210)

```javascript
const updateReasoningState = () => {
  const isOn = reasoningToggle.checked;

  // Update label UI
  reasoningState.textContent = isOn ? 'ON' : 'OFF';
  reasoningState.classList.toggle('is-off', !isOn);

  // Re-render konten buffer yang sudah ada
  if (buffer) {
    renderWithMarked(buffer);
  }
};

reasoningToggle.addEventListener('change', updateReasoningState);
```

**Keunikan:** Toggle dapat diubah **di tengah-tengah streaming** dan UI akan langsung menyesuaikan tanpa memanggil ulang API.

---

## Komponen Backend

### 1. SSE Event Format

**File:** `server.js` (baris 72-75)

```javascript
const sendEvent = (event, data) => {
  const payload = data !== undefined ? `data: ${JSON.stringify(data)}\n\n` : '\n';
  res.write(event ? `event: ${event}\n${payload}` : payload);
};
```

Format SSE standar:
```
event: config
data: {"reasoningMode":"on","source":"/api/reasoning"}

event: message
data: {"text":"<think>"}

event: message
data: {"text":"Let me analyze"}

event: end
data: {}
```

### 2. Error Handling

**File:** `server.js` (baris 103-108)

```javascript
try {
  // ... streaming logic
} catch (error) {
  console.error('OpenAI streaming error:', error);
  sendEvent('error', { message: 'Terjadi kesalahan saat memanggil model.' });
} finally {
  res.end();
}
```

Tipe error yang ditangani:
- **Network error:** Koneksi ke LLM API gagal
- **API error:** Model error (rate limit, invalid key, dll)
- **Timeout:** Request terlalu lama (bergantung pada SDK)

### 3. Routing

**File:** `server.js` (baris 33-37, 111)

```javascript
// Render halaman
app.get('/on_off_reasoning', (req, res) => {
  res.render('on_off_reasoning', {
    pageId: 'on_off_reasoning',
  });
});

// API endpoint
app.get('/api/reasoning', streamResponse);
```

---

## Perilaku UI Detail

### Toggle Reasoning: ON

**Visual:**
```
┌─────────────────────────────────────────────┐
│ ▼ Model reasoning                           │
│   Let me break down this problem:          │
│   1. First, I need to understand...        │
│   2. Then I should consider...             ▮│ ← blinking caret
└─────────────────────────────────────────────┘

The answer is: ...
```

- Tag `<details>` otomatis terbuka (`open` attribute)
- Konten reasoning di-escape HTML untuk keamanan
- Kursor berkedip (`.stream-caret`) muncul selama `</think>` belum diterima
- Setelah `</think>` diterima, kursor hilang dan `<details>` bisa di-collapse

### Toggle Reasoning: OFF

**Visual:**
```
┌─────────────────────────────────────────────┐
│ (kosong sampai </think> diterima)           │
└─────────────────────────────────────────────┘
```

Setelah `</think>`:
```
┌─────────────────────────────────────────────┐
│ The answer is: ...                          │
│ • Point 1                                   │
│ • Point 2                                   │
└─────────────────────────────────────────────┘
```

- Seluruh konten `<think>` diabaikan
- UI menunggu sampai tag penutup `</think>` diterima
- Hanya menampilkan konten setelah `</think>`

### CSS Animations

**File:** `views/layout.njk` (baris 89-107)

**Stream Caret (kursor berkedip):**
```css
.stream-caret {
  display: inline-block;
  width: 0.55rem;
  height: 1em;
  margin-left: 0.25rem;
  background: rgba(99, 102, 241, 0.6);
  animation: stream-caret-blink 1s step-end infinite;
  vertical-align: baseline;
}

@keyframes stream-caret-blink {
  50% {
    opacity: 0;
  }
}

.think-complete .stream-caret {
  display: none;  /* Hilang setelah reasoning selesai */
}
```

**Think Block Styling:**
```css
.think-block {
  margin-top: 1rem;
  border: 1px solid #cbd5f5;
  border-radius: 0.5rem;
  background: #eef2ff;
  color: #1f2933;
}

.think-block > summary {
  cursor: pointer;
  padding: 0.75rem 1rem;
  font-weight: 600;
  color: #1e3a8a;
}
```

---

## Konfigurasi Environment

### File: `.env`

```bash
# LLM API Configuration
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
LLM_MODEL_NAME=gpt-4o-mini
LLM_MAX_TOKENS=4096

# Server Configuration
PORT=3000
```

### Variabel Environment

| Variabel | Required | Default | Deskripsi |
| --- | --- | --- | --- |
| `LLM_BASE_URL` | ✅ | - | Base URL endpoint LLM API (misal OpenRouter, Ollama, dll) |
| `LLM_API_KEY` | ✅ | - | API key untuk autentikasi |
| `LLM_MODEL_NAME` | ❌ | `gpt-4o-mini` | Nama model yang akan digunakan |
| `LLM_MAX_TOKENS` | ❌ | `4096` | Maksimum token response |
| `PORT` | ❌ | `3000` | Port server Express |

### Kompatibilitas API

Karena menggunakan OpenAI SDK, proyek ini kompatibel dengan:
- **OpenAI API** (GPT-4, GPT-4o, GPT-3.5)
- **Azure OpenAI**
- **OpenRouter** (akses ratusan model)
- **Ollama** (local LLM)
- **Any OpenAI-compatible API**

**Contoh konfigurasi OpenRouter:**
```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-v1-xxxxxxxxxxxxx
LLM_MODEL_NAME=anthropic/claude-3.5-sonnet
```

**Contoh konfigurasi Ollama (local):**
```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=dummy  # Ollama tidak memerlukan key, tapi SDK butuh value
LLM_MODEL_NAME=llama3.1:latest
```

---

## Pengujian Manual

### Setup Awal

```bash
# 1. Install dependencies
npm install

# 2. Copy dan edit .env
cp .env.example .env
nano .env  # atau code .env

# 3. Jalankan server
node server.js
```

Output yang diharapkan:
```
Server listening on http://localhost:3000
```

### Test Case 1: Basic Streaming (Reasoning ON)

1. Buka `http://localhost:3000/on_off_reasoning`
2. Masukkan prompt: `"Jelaskan apa itu rekursi dalam 3 paragraf"`
3. Pastikan toggle **Reasoning ON**
4. Klik **Kirim ke Model**

**Expected Result:**
- Status berubah: `"Streaming dimulai (Reasoning ON)"`
- Muncul blok `▼ Model reasoning` dengan kursor berkedip
- Setelah `</think>`, jawaban final muncul di bawahnya
- Status akhir: `"Streaming selesai."`

### Test Case 2: Reasoning OFF

1. Masukkan prompt yang sama
2. Toggle **Reasoning OFF**
3. Klik **Kirim ke Model**

**Expected Result:**
- Status: `"Streaming dimulai (Reasoning OFF)"`
- Panel output **kosong** sampai `</think>` diterima
- Hanya jawaban akhir yang muncul
- Tidak ada blok reasoning

### Test Case 3: Stop Streaming

1. Masukkan prompt panjang: `"Tulis essay 1000 kata tentang AI"`
2. Reasoning ON
3. Klik **Kirim ke Model**
4. Setelah beberapa detik, klik **Stop**

**Expected Result:**
- Streaming berhenti segera
- Status: `"Streaming dihentikan."`
- Tombol **Kirim ke Model** aktif kembali
- Output menampilkan token yang sudah diterima sebelum stop

### Test Case 4: Toggle During Streaming

1. Kirim prompt apapun dengan Reasoning ON
2. **Saat sedang streaming**, ubah toggle menjadi OFF
3. Ubah lagi menjadi ON

**Expected Result:**
- UI langsung menyesuaikan tanpa reload
- OFF: blok reasoning hilang
- ON: blok reasoning muncul kembali
- Streaming tetap berjalan di background

### Test Case 5: Markdown Rendering

1. Masukkan prompt:
```
Buat list 5 bahasa pemrograman dengan code example untuk "hello world"
```
2. Reasoning OFF (untuk fokus pada output)
3. Klik **Kirim ke Model**

**Expected Result:**
- List terformat dengan bullet points
- Code block dengan syntax highlighting
- Heading (jika ada) terformat dengan benar

### Test Case 6: Error Handling

**A. Invalid API Key**
1. Edit `.env`: set `LLM_API_KEY=invalid_key`
2. Restart server
3. Kirim prompt

**Expected Result:**
- Status: `"Terjadi kesalahan saat memanggil model."`
- Tombol submit aktif kembali

**B. Missing Prompt**
1. Kosongkan textarea
2. Klik submit

**Expected Result:**
- Browser validation: `"Prompt tidak boleh kosong."`

---

## Troubleshooting

### Problem: "LLM API key belum dikonfigurasi"

**Penyebab:**
- File `.env` tidak ada atau tidak terbaca
- Variabel `LLM_API_KEY` kosong

**Solusi:**
```bash
# Pastikan .env ada di root directory
ls -la .env

# Pastikan dotenv di-load
# Cek baris 1 server.js: require('dotenv').config();

# Test manual
node -e "require('dotenv').config(); console.log(process.env.LLM_API_KEY)"
```

### Problem: Streaming tidak muncul / stuck

**Penyebab:**
- Model tidak mendukung streaming
- Response terlalu lambat (network issue)
- CORS issue (jika deploy ke production)

**Solusi:**
```bash
# 1. Test koneksi ke LLM API
curl -X POST $LLM_BASE_URL/chat/completions \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"test"}],"stream":false}'

# 2. Cek browser console untuk error JavaScript
# F12 → Console

# 3. Cek server logs
node server.js
# Amati output saat melakukan request
```

### Problem: Reasoning block tidak muncul meski toggle ON

**Penyebab:**
- Model tidak menghasilkan tag `<think>` (tergantung model dan prompt)
- Model tidak mengikuti system prompt

**Solusi:**
```javascript
// Edit system prompt di server.js:79-82 untuk lebih eksplisit
const systemPrompt = reasoningMode === 'off'
  ? 'You are a helpful assistant. Respond directly without any thinking process. Do not use <think> tags.'
  : `You are a helpful assistant. IMPORTANT: Always show your thinking process inside <think>...</think> tags before giving the final answer.

Example format:
<think>
Step 1: ...
Step 2: ...
</think>
Final answer here.`;
```

### Problem: Markdown tidak ter-render

**Penyebab:**
- CDN marked.js tidak ter-load
- JavaScript error

**Solusi:**
```html
<!-- views/on_off_reasoning.njk:33 -->
<!-- Ganti CDN jika perlu -->
<script src="https://cdn.jsdelivr.net/npm/marked@latest/marked.min.js"></script>

<!-- Atau download local -->
<script src="/static/marked.min.js"></script>
```

### Problem: EventSource connection failed

**Penyebab:**
- Server tidak mengirim SSE headers dengan benar
- Browser compatibility (IE tidak support SSE)

**Solusi:**
```javascript
// Tambahkan fallback di client
if (typeof EventSource === 'undefined') {
  alert('Browser Anda tidak mendukung Server-Sent Events. Gunakan Chrome/Firefox/Safari.');
}

// Server-side: pastikan headers benar
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache, no-transform');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no'); // Untuk Nginx
```

---

## Pengembangan Lanjutan

### 1. Model Selector Dropdown

**Frontend (`on_off_reasoning.njk`):**
```html
<div class="field">
  <label for="model-select">Model:</label>
  <select id="model-select" name="model">
    <option value="gpt-4o-mini">GPT-4o Mini (fast)</option>
    <option value="gpt-4o">GPT-4o (balanced)</option>
    <option value="o1-preview">O1 Preview (reasoning)</option>
  </select>
</div>
```

**Backend (`server.js`):**
```javascript
const modelName = req.query.model || process.env.LLM_MODEL_NAME || 'gpt-4o-mini';

const stream = await openai.chat.completions.create({
  model: modelName,
  // ...
});
```

### 2. Conversation History

**Implementasi localStorage:**
```javascript
// Simpan setiap response
const saveToHistory = (prompt, response) => {
  const history = JSON.parse(localStorage.getItem('reasoning_history') || '[]');
  history.push({
    timestamp: Date.now(),
    prompt,
    response,
    reasoningMode: reasoningToggle.checked ? 'on' : 'off'
  });
  localStorage.setItem('reasoning_history', JSON.stringify(history));
};

// Load history saat page load
const loadHistory = () => {
  const history = JSON.parse(localStorage.getItem('reasoning_history') || '[]');
  // Render history list
};
```

### 3. Token Usage Metrics

**Backend modification:**
```javascript
for await (const part of stream) {
  const text = part.choices?.[0]?.delta?.content || '';
  if (text) {
    sendEvent('message', { text });
  }

  // Kirim usage data jika tersedia
  if (part.usage) {
    sendEvent('usage', {
      prompt_tokens: part.usage.prompt_tokens,
      completion_tokens: part.usage.completion_tokens,
      total_tokens: part.usage.total_tokens
    });
  }
}
```

**Frontend:**
```javascript
source.addEventListener('usage', (usageEvent) => {
  const usage = JSON.parse(usageEvent.data);
  document.getElementById('token-usage').textContent =
    `Tokens: ${usage.total_tokens} (${usage.prompt_tokens} + ${usage.completion_tokens})`;
});
```

### 4. Multi-turn Conversation

**State management:**
```javascript
let conversationHistory = [];

// Saat submit
conversationHistory.push({ role: 'user', content: prompt });

// Request ke server
const params = new URLSearchParams({
  prompt,
  reasoning: reasoningToggle.checked ? 'on' : 'off',
  history: JSON.stringify(conversationHistory)
});

// Server-side
const history = JSON.parse(req.query.history || '[]');
const messages = [
  { role: 'system', content: systemPrompt },
  ...history,
  { role: 'user', content: prompt }
];
```

### 5. Export Conversation

```javascript
const exportAsMarkdown = () => {
  const history = JSON.parse(localStorage.getItem('reasoning_history') || '[]');

  let markdown = '# Reasoning History\n\n';
  history.forEach((item, index) => {
    markdown += `## Conversation ${index + 1}\n`;
    markdown += `**Date:** ${new Date(item.timestamp).toLocaleString()}\n`;
    markdown += `**Mode:** ${item.reasoningMode}\n\n`;
    markdown += `**Prompt:**\n${item.prompt}\n\n`;
    markdown += `**Response:**\n${item.response}\n\n`;
    markdown += '---\n\n';
  });

  // Download
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reasoning-history-${Date.now()}.md`;
  a.click();
};
```

### 6. Real-time Toggle Sync (Multi-tab)

```javascript
// Broadcast toggle state via BroadcastChannel
const channel = new BroadcastChannel('reasoning_toggle');

reasoningToggle.addEventListener('change', () => {
  channel.postMessage({ reasoning: reasoningToggle.checked });
});

channel.onmessage = (event) => {
  reasoningToggle.checked = event.data.reasoning;
  updateReasoningState();
};
```

### 7. Progressive Enhancement: Abort Controller

```javascript
let abortController;

// Saat submit
abortController = new AbortController();

const stream = await openai.chat.completions.create({
  model: modelName,
  messages: [...],
  stream: true,
  signal: abortController.signal  // Tambahkan abort signal
});

// Saat stop
stopButton.addEventListener('click', () => {
  if (abortController) {
    abortController.abort();  // Server-side abort
  }
  closeSource();  // Client-side close
});
```

---

## Lisensi dan Kontribusi

**Repository:** https://github.com/algonacci/llm_technique

Untuk pertanyaan atau bug report, silakan buat issue di repository GitHub.
