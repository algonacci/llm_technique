## Stop Streaming Response Page

Halaman **Stop Streaming Response** fokus pada skenario menghentikan output LLM yang panjang secara manual agar pengguna dapat segera memberi instruksi baru atau menghemat token. Fitur ini sangat berguna untuk:

- **Long-form content**: Menghentikan essay panjang saat informasi yang diperlukan sudah diperoleh
- **Cost optimization**: Menghemat token API jika jawaban sudah cukup
- **Interactive exploration**: Mencoba berbagai prompt dengan cepat tanpa menunggu streaming selesai

---

## Daftar Isi

- [Perbedaan dengan ON/OFF Reasoning](#perbedaan-dengan-onoff-reasoning)
- [Arsitektur dan Komponen](#arsitektur-dan-komponen)
- [Alur Interaksi User](#alur-interaksi-user)
- [Implementasi Client-Side](#implementasi-client-side)
- [Implementasi Server-Side](#implementasi-server-side)
- [State Management](#state-management)
- [Use Cases dan Best Practices](#use-cases-dan-best-practices)
- [Testing Manual](#testing-manual)
- [Troubleshooting](#troubleshooting)
- [Pengembangan Lanjutan](#pengembangan-lanjutan)

---

## Perbedaan dengan ON/OFF Reasoning

Meskipun secara visual dan fungsional mirip dengan halaman ON/OFF Reasoning, halaman **Stop Streaming Response** menekankan aspek berikut:

### Fokus Utama

| Aspek | ON/OFF Reasoning | Stop Streaming Response |
| --- | --- | --- |
| **Tujuan** | Kontrol visibilitas reasoning | Kontrol lifecycle streaming |
| **Fitur Utama** | Toggle reasoning display | Tombol Stop yang interaktif |
| **Use Case** | Memilih apakah ingin melihat proses berpikir model | Menghentikan response panjang untuk efisiensi |
| **Endpoint** | `/api/reasoning` | `/api/stop-streaming` |
| **Button Label** | "Kirim ke Model" | "Mulai Streaming" |

### Kesamaan Implementasi

Kedua halaman menggunakan **handler backend yang sama** (`streamResponse`), sehingga:
- ✅ Mendukung toggle reasoning (ON/OFF)
- ✅ Menggunakan SSE (Server-Sent Events)
- ✅ Format event identik (`config`, `message`, `end`, `error`)
- ✅ Rendering logic sama (parsing `<think>` tags)

### Perbedaan UX

**ON/OFF Reasoning:**
```
User flow: Input prompt → Toggle reasoning → Submit → Tunggu selesai
Focus: Memahami bagaimana model berpikir
```

**Stop Streaming Response:**
```
User flow: Input prompt → Start streaming → Monitor output → Stop kapan saja
Focus: Kontrol penuh terhadap durasi dan biaya
```

---

## Arsitektur dan Komponen

### Stack Teknologi

Identik dengan halaman ON/OFF Reasoning (lihat dokumentasi lengkap di `ON_OFF_REASONING.md`):

| Komponen | Teknologi | Peran |
| --- | --- | --- |
| Frontend | Nunjucks + Vanilla JS | Template rendering dan event handling |
| Backend | Express.js | HTTP server dan SSE streaming |
| LLM Client | OpenAI SDK | API integration |
| Streaming Protocol | Server-Sent Events (SSE) | Real-time data push |

### Arsitektur File

```
llm_technique/
├── server.js                              # Shared backend
│   └── streamResponse()                   # Handler untuk /api/stop-streaming
├── views/
│   ├── layout.njk                         # Shared CSS dan styling
│   ├── stop_streaming_response.njk        # Halaman ini
│   └── on_off_reasoning.njk               # Halaman saudara
└── .env                                   # Shared configuration
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                stop_streaming_response.njk                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  UI Components                                         │ │
│  │  ├─ Form                                               │ │
│  │  │  ├─ Textarea (prompt input)                        │ │
│  │  │  ├─ Toggle (reasoning ON/OFF)                      │ │
│  │  │  ├─ Button "Mulai Streaming" (submit)              │ │
│  │  │  └─ Button "Stop" (abort streaming) ◄── FOCUS      │ │
│  │  ├─ Status indicator                                  │ │
│  │  └─ Output panel (stream-output)                      │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  JavaScript Logic                                      │ │
│  │  ├─ EventSource (SSE client)                          │ │
│  │  ├─ closeSource() ◄── Called by Stop button           │ │
│  │  ├─ renderWithMarked()                                │ │
│  │  └─ Event listeners (message, end, error, config)     │ │
│  └────────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────────┘
                        │ SSE
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    server.js                                 │
│  GET /api/stop-streaming → streamResponse()                 │
│    ├─ Validasi                                              │
│    ├─ SSE headers                                           │
│    ├─ Stream dari LLM API                                   │
│    └─ Handle client disconnect ◄── Triggered by Stop        │
└─────────────────────────────────────────────────────────────┘
```

---

## Alur Interaksi User

### Skenario 1: Streaming Normal (Selesai Sempurna)

```
[1] User mengisi prompt: "Tulis essay 500 kata tentang AI"
[2] User menekan "Mulai Streaming"
     ├─ Submit button disabled
     ├─ Stop button enabled
     └─ Status: "Meminta respon..."

[3] SSE connection opened → /api/stop-streaming?prompt=...&reasoning=on

[4] Event 'config' received
     └─ Status: "Streaming dimulai (Reasoning ON)"

[5] Event 'message' received (loop)
     ├─ buffer += payload.text
     ├─ renderWithMarked(buffer)
     └─ UI updates progressively

[6] Event 'end' received
     ├─ Status: "Streaming selesai."
     ├─ Submit button enabled
     ├─ Stop button disabled
     └─ SSE connection closed
```

### Skenario 2: User Menekan Stop (Manual Abort)

```
[1-4] Same as Skenario 1

[5] Event 'message' received (partial)
     └─ UI menampilkan 50% dari essay

[6] User clicks "Stop" button
     ├─ closeSource() called
     │   ├─ source.close()        ← EventSource disconnected
     │   ├─ source = null
     │   └─ stopButton.disabled = true
     ├─ Status: "Streaming dihentikan."
     └─ Submit button enabled

[7] UI tetap menampilkan konten yang sudah diterima (50%)
```

### Skenario 3: Error Handling

```
[1-4] Same as Skenario 1

[5] Event 'error' received
     ├─ Possible causes:
     │   ├─ Network failure
     │   ├─ API error (rate limit, invalid key)
     │   └─ Server crash
     ├─ Status: "Terjadi kesalahan saat memanggil model."
     ├─ Submit button enabled
     ├─ Stop button disabled
     └─ SSE connection auto-closed
```

---

## Implementasi Client-Side

### 1. Form Structure

**File:** `views/stop_streaming_response.njk` (baris 9-27)

```html
<form id="stop-streaming-form" class="reasoning-form">
  <!-- Prompt input -->
  <div class="field">
    <label for="stop-streaming-prompt">Masukkan prompt:</label>
    <textarea
      id="stop-streaming-prompt"
      name="prompt"
      rows="6"
      placeholder="Tuliskan instruksi yang ingin diuji dengan streaming..."
      required>
    </textarea>
  </div>

  <!-- Reasoning toggle -->
  <div class="toggle">
    <span class="toggle-label">Reasoning</span>
    <label class="switch">
      <input type="checkbox" id="stop-reasoning-toggle" name="reasoning" checked />
      <span class="slider"></span>
    </label>
    <span id="stop-reasoning-state" class="toggle-state">ON</span>
  </div>

  <!-- Actions -->
  <div class="actions">
    <button type="submit">Mulai Streaming</button>
    <button type="button" id="stop-streaming-stop" class="button-secondary" disabled>
      Stop
    </button>
    <span id="stop-status" class="status-text"></span>
  </div>
</form>
```

**Perbedaan Kunci:**
- Button submit label: `"Mulai Streaming"` (vs `"Kirim ke Model"` di ON/OFF Reasoning)
- Element IDs: Prefix `stop-` untuk menghindari konflik namespace

### 2. Stop Button Handler

**File:** `views/stop_streaming_response.njk` (baris 194-198)

```javascript
stopButton.addEventListener('click', () => {
  status.textContent = 'Streaming dihentikan.';
  closeSource();
  submitButton.disabled = false;
});
```

**Fungsi `closeSource()`** (baris 48-54):

```javascript
const closeSource = () => {
  if (source) {
    source.close();        // [1] Tutup koneksi EventSource
    source = null;         // [2] Clear reference
    stopButton.disabled = true;  // [3] Disable stop button
  }
};
```

**Perilaku:**
1. **Client-side disconnect**: `source.close()` mengirim sinyal disconnect ke server
2. **UI state update**: Stop button disabled, submit enabled
3. **Buffer preserved**: Konten yang sudah di-buffer tetap ditampilkan
4. **No server notification**: Backend tidak mendapat notifikasi eksplisit (connection just drops)

### 3. EventSource Lifecycle

**Initialization** (baris 129-141):

```javascript
form.addEventListener('submit', (event) => {
  event.preventDefault();

  closeSource();  // [1] Close previous connection if any
  buffer = '';    // [2] Reset buffer
  output.innerHTML = '';  // [3] Clear output

  submitButton.disabled = true;
  stopButton.disabled = false;  // [4] Enable stop button

  const params = new URLSearchParams({
    prompt: promptInput.value.trim(),
    reasoning: reasoningToggle.checked ? 'on' : 'off',
  });

  source = new EventSource(`/api/stop-streaming?${params.toString()}`);

  // [5] Attach event listeners
  source.addEventListener('message', handleMessage);
  source.addEventListener('end', handleEnd);
  source.addEventListener('config', handleConfig);
  source.addEventListener('error', handleError);
});
```

**Cleanup on page unload** (baris 192):

```javascript
window.addEventListener('beforeunload', closeSource);
```

Memastikan koneksi SSE ditutup dengan benar saat user:
- Close tab
- Refresh page
- Navigate away

### 4. Rendering Logic (Identical to ON/OFF Reasoning)

**File:** `views/stop_streaming_response.njk` (baris 67-118)

Fungsi `renderWithMarked` identik 100% dengan halaman ON/OFF Reasoning. Dokumentasi lengkap dapat dilihat di `ON_OFF_REASONING.md` bagian "Komponen Frontend > 2. Rendering Logic".

**Key features:**
- Parsing `<think>` tags
- Conditional rendering berdasarkan toggle state
- Markdown conversion via `marked.parse()`
- Streaming caret animation
- HTML escaping untuk keamanan

---

## Implementasi Server-Side

### Shared Handler

**File:** `server.js` (baris 111-112)

```javascript
app.get('/api/reasoning', streamResponse);
app.get('/api/stop-streaming', streamResponse);  // Same handler!
```

Kedua endpoint menggunakan handler yang sama, sehingga:
- ✅ **Code reusability**: Tidak ada duplikasi logic
- ✅ **Consistency**: Perilaku identik di kedua halaman
- ✅ **Maintainability**: Update sekali, apply ke semua endpoint

### Client Disconnect Detection

**Automatic handling** (baris 106-108):

```javascript
try {
  // ... streaming logic
} catch (error) {
  console.error('OpenAI streaming error:', error);
  sendEvent('error', { message: 'Terjadi kesalahan saat memanggil model.' });
} finally {
  res.end();  // [1] Always close response stream
}
```

**Saat client menekan Stop:**
1. Client memanggil `source.close()`
2. Browser closes SSE connection
3. Server's `res` stream detects disconnect
4. Node.js throws error jika mencoba `res.write()` setelah disconnect
5. Error ditangkap di `catch` block atau streaming loop berhenti natural
6. `finally` block memastikan `res.end()` dipanggil

**Note:** Saat ini, server **tidak menghentikan** request ke LLM API saat client disconnect. LLM tetap menghasilkan token yang diabaikan. Lihat [Pengembangan Lanjutan](#pengembangan-lanjutan) untuk implementasi abort controller.

---

## State Management

### Client-Side State

```javascript
// Global state dalam IIFE
let source;           // EventSource instance (null saat tidak streaming)
let buffer = '';      // Accumulated text dari semua event 'message'
```

**State transitions:**

```
Initial State:
  source: null
  buffer: ''
  submitButton: enabled
  stopButton: disabled

After Submit:
  source: EventSource instance
  buffer: '' (reset)
  submitButton: disabled
  stopButton: enabled

During Streaming:
  source: EventSource instance (connected)
  buffer: accumulating text
  submitButton: disabled
  stopButton: enabled

After Stop (manual):
  source: null
  buffer: preserved (contains partial response)
  submitButton: enabled
  stopButton: disabled

After End (complete):
  source: null
  buffer: preserved (contains full response)
  submitButton: enabled
  stopButton: disabled
```

### Toggle State Independence

**Penting:** Toggle reasoning dapat diubah kapan saja tanpa mempengaruhi streaming state:

```javascript
// Baris 200-210
reasoningToggle.addEventListener('change', updateReasoningState);

const updateReasoningState = () => {
  const isOn = reasoningToggle.checked;
  reasoningState.textContent = isOn ? 'ON' : 'OFF';
  reasoningState.classList.toggle('is-off', !isOn);

  if (buffer) {
    renderWithMarked(buffer);  // Re-render dengan state baru
  }
};
```

**Contoh flow:**
1. User start streaming dengan Reasoning ON
2. Model mulai mengirim `<think>` content
3. User toggle ke OFF **saat streaming**
4. UI langsung hide reasoning block
5. Streaming tetap berjalan di background
6. User toggle kembali ke ON
7. Reasoning block muncul lagi dengan konten ter-update

---

## Use Cases dan Best Practices

### Use Case 1: Long-Form Content Generation

**Scenario:**
```
User meminta: "Tulis artikel 2000 kata tentang sejarah JavaScript"
Model mulai streaming...
Setelah 500 kata, user merasa sudah cukup untuk memahami konteks.
```

**Best Practice:**
```javascript
// User presses Stop setelah mendapat informasi yang dibutuhkan
// Output yang sudah diterima tetap bisa:
// - Di-copy ke clipboard
// - Digunakan sebagai starting point untuk edit manual
// - Disimpan ke localStorage
```

**Benefit:**
- Hemat token API (hanya bayar untuk 500 kata, bukan 2000)
- Faster iteration (coba prompt lain lebih cepat)

### Use Case 2: Exploratory Prompting

**Scenario:**
```
User mencoba berbagai variasi prompt untuk menemukan formula terbaik:
- "Jelaskan X dengan gaya casual"
- "Jelaskan X dengan gaya akademik"
- "Jelaskan X untuk anak 10 tahun"

Setiap prompt, user hanya perlu 2-3 kalimat pertama untuk judge kualitasnya.
```

**Best Practice:**
```javascript
// Workflow:
// 1. Start streaming
// 2. Baca 2-3 kalimat pertama
// 3. Jika tidak sesuai → Stop → Edit prompt → Retry
// 4. Jika bagus → Biarkan selesai
```

**Benefit:**
- Rapid prototyping
- Cost-efficient exploration
- Quick feedback loop

### Use Case 3: Token Budget Management

**Scenario:**
```
API plan: 100K tokens/month
Hari ini tinggal 5K tokens
Perlu 3 response penting, tapi tidak tahu panjangnya
```

**Best Practice:**
```javascript
// Monitor output length secara visual
// Stop jika response melebihi expected length
// Tambahkan counter di UI (lihat Pengembangan Lanjutan)

// Example:
source.addEventListener('message', (e) => {
  const tokenCount = buffer.split(/\s+/).length;  // Rough estimate
  if (tokenCount > 500) {
    alert('Response melebihi 500 tokens. Pertimbangkan stop.');
  }
});
```

### Use Case 4: Debugging Prompt Engineering

**Scenario:**
```
System prompt tidak bekerja seperti yang diharapkan.
User ingin test apakah model mengikuti instruksi sejak awal response.
```

**Best Practice:**
```javascript
// Start streaming dengan Reasoning ON
// Amati <think> block di awal response
// Jika reasoning tidak sesuai → Stop segera → Revise system prompt
// Tidak perlu menunggu full response untuk tahu prompt bermasalah
```

---

## Testing Manual

### Setup

```bash
# Sama dengan ON/OFF Reasoning
npm install
node server.js
# Buka http://localhost:3000/stop_streaming_response
```

### Test Case 1: Basic Stop Functionality

**Steps:**
1. Input prompt: `"Tulis essay 1000 kata tentang blockchain"`
2. Toggle Reasoning: OFF (untuk fokus pada output)
3. Klik **Mulai Streaming**
4. Tunggu hingga ~50 kata muncul
5. Klik **Stop**

**Expected Result:**
- ✅ Streaming berhenti immediately
- ✅ Status berubah: `"Streaming dihentikan."`
- ✅ Button "Mulai Streaming" enabled kembali
- ✅ Button "Stop" disabled
- ✅ Output menampilkan ~50 kata yang sudah diterima
- ✅ Output tetap bisa di-scroll dan di-select

### Test Case 2: Stop During Reasoning Block

**Steps:**
1. Input prompt: `"Solve this math problem: 123 × 456 + 789"`
2. Toggle Reasoning: ON
3. Klik **Mulai Streaming**
4. Tunggu hingga reasoning block muncul
5. **Saat reasoning masih streaming** (sebelum `</think>` diterima), klik **Stop**

**Expected Result:**
- ✅ Streaming stops
- ✅ Reasoning block tetap terbuka (karena incomplete)
- ✅ Streaming caret (▮) masih terlihat (karena reasoning tidak complete)
- ✅ Tidak ada answer section (karena `</think>` belum diterima)

**Visual:**
```
┌─────────────────────────────────────────┐
│ ▼ Model reasoning                       │
│   Step 1: First I need to multiply...  │
│   Step 2: Then I will add...           ▮│ ← Caret still blinking
└─────────────────────────────────────────┘
(No answer section below)
```

### Test Case 3: Stop → Resume dengan Prompt Baru

**Steps:**
1. Start streaming dengan prompt A
2. Stop setelah beberapa detik
3. **Langsung** input prompt B (tanpa reload page)
4. Start streaming lagi

**Expected Result:**
- ✅ Buffer di-reset (output lama hilang)
- ✅ Koneksi SSE baru terbuka
- ✅ Response dari prompt B muncul
- ✅ Tidak ada "memory" dari prompt A

**Verification:**
```javascript
// Check in browser console (F12):
// Seharusnya ada 2 EventSource connections (closed yang lama, open yang baru)
```

### Test Case 4: Multiple Rapid Stops

**Steps:**
1. Start streaming
2. Stop setelah 1 detik
3. Langsung start lagi
4. Stop setelah 1 detik
5. Ulangi 3x

**Expected Result:**
- ✅ Setiap cycle berhasil
- ✅ Tidak ada error di console
- ✅ Tidak ada memory leak (check di Chrome DevTools → Performance Monitor)
- ✅ Button states konsisten

### Test Case 5: Toggle During Streaming, Then Stop

**Steps:**
1. Start streaming dengan Reasoning ON
2. Saat reasoning block muncul, toggle ke OFF
3. Lihat reasoning hilang
4. Toggle kembali ke ON
5. Lihat reasoning muncul lagi
6. Klik Stop

**Expected Result:**
- ✅ Toggle responsive selama streaming
- ✅ UI update instant saat toggle
- ✅ Stop berfungsi normal meski toggle diubah-ubah
- ✅ Final state: reasoning visibility sesuai toggle position saat stop

### Test Case 6: Network Disconnect Simulation

**Steps:**
1. Start streaming
2. Buka Chrome DevTools → Network tab
3. Enable "Offline" mode **saat streaming berjalan**
4. Amati perilaku

**Expected Result:**
- ✅ Event 'error' listener triggered
- ✅ Status: `"Koneksi streaming terputus."`
- ✅ Buttons reset (submit enabled, stop disabled)
- ✅ Output preserved

### Test Case 7: Long Response (Stress Test)

**Steps:**
1. Input prompt: `"Write a 5000-word essay on climate change"`
2. Reasoning OFF
3. Start streaming
4. **Jangan stop**, biarkan sampai selesai

**Expected Result:**
- ✅ Streaming berjalan sampai model selesai
- ✅ Tidak ada lag atau freeze UI
- ✅ Markdown rendering tetap bekerja
- ✅ Event 'end' received
- ✅ Status: `"Streaming selesai."`

**Performance check:**
```javascript
// Monitoring di console:
// - Memory usage tidak meledak
// - Frame rate stabil (60 FPS)
// - No jank saat render markdown
```

---

## Troubleshooting

### Problem: Stop Button Tidak Berfungsi

**Symptom:**
- User klik Stop, tapi streaming tetap berjalan
- Button state tidak berubah

**Penyebab:**
1. Event listener tidak terpasang
2. JavaScript error di console
3. `source` variable tidak terset dengan benar

**Solusi:**
```javascript
// Debug di browser console:
console.log('source instance:', source);
console.log('source readyState:', source?.readyState);
// 0 = CONNECTING, 1 = OPEN, 2 = CLOSED

// Check event listener:
stopButton.addEventListener('click', () => {
  console.log('Stop clicked, source:', source);
  closeSource();
});
```

### Problem: Buffer Tidak Di-reset Setelah Stop

**Symptom:**
- User stop streaming, submit prompt baru
- Response baru di-append ke response lama

**Penyebab:**
- `buffer = ''` tidak dipanggil di submit handler

**Solusi:**
```javascript
// Pastikan di form submit handler (baris 130):
form.addEventListener('submit', (event) => {
  event.preventDefault();
  closeSource();
  buffer = '';        // ← Harus ada ini
  output.innerHTML = '';
  // ...
});
```

### Problem: Memory Leak Setelah Multiple Stop

**Symptom:**
- Setelah 10-20x stop-start cycle, browser jadi lambat
- Chrome Task Manager menunjukkan memory usage tinggi

**Penyebab:**
- EventSource tidak di-close dengan benar
- Event listener tidak di-remove

**Solusi:**
```javascript
const closeSource = () => {
  if (source) {
    // Remove event listeners sebelum close
    source.removeEventListener('message', handleMessage);
    source.removeEventListener('end', handleEnd);
    source.removeEventListener('config', handleConfig);
    source.removeEventListener('error', handleError);

    source.close();
    source = null;
    stopButton.disabled = true;
  }
};

// Atau gunakan named function untuk easy removal:
const handleMessage = (e) => { /* ... */ };
source.addEventListener('message', handleMessage);
```

### Problem: Server Terus Mengirim Data Setelah Client Stop

**Symptom:**
- Server logs menunjukkan streaming terus berjalan
- Token API tetap terpakai meski user sudah stop

**Penyebab:**
- Server tidak detect client disconnect
- Streaming loop tidak check connection status

**Current Limitation:**
Implementasi saat ini memang tidak abort server-side streaming. Server terus request ke LLM sampai selesai, hanya client yang tidak terima data.

**Solusi:**
Lihat [Pengembangan Lanjutan > 1. Server-Side Abort Controller](#1-server-side-abort-controller)

### Problem: UI Freeze Saat Stop di Mid-Reasoning

**Symptom:**
- User stop saat reasoning block sedang streaming
- UI freeze sejenak

**Penyebab:**
- Rendering logic mencoba parse incomplete HTML
- `marked.parse()` error pada malformed markdown

**Solusi:**
```javascript
// Wrap marked.parse() dengan try-catch:
const renderWithMarked = (text) => {
  // ... parsing logic

  try {
    if (shouldShowAnswer && answerContent.trim()) {
      html += marked.parse(answerContent);
    }
  } catch (error) {
    console.warn('Markdown parsing error:', error);
    html += `<pre>${escapeHtml(answerContent)}</pre>`;  // Fallback
  }

  output.innerHTML = html;
};
```

---

## Pengembangan Lanjutan

### 1. Server-Side Abort Controller

**Problem:** Saat client stop, server tetap consume LLM API tokens.

**Solution:**

**Backend (`server.js`):**
```javascript
const streamResponse = async (req, res) => {
  const prompt = req.query.prompt;
  const reasoningMode = req.query.reasoning === 'off' ? 'off' : 'on';

  // ... validation

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sendEvent('config', { reasoningMode, source: req.path });

  // [NEW] Create AbortController
  const abortController = new AbortController();

  // [NEW] Detect client disconnect
  req.on('close', () => {
    console.log('Client disconnected, aborting LLM request');
    abortController.abort();
  });

  const systemPrompt = /* ... */;

  try {
    const stream = await openai.chat.completions.create({
      model: process.env.LLM_MODEL_NAME || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: Number(process.env.LLM_MAX_TOKENS) || 4096,
      stream: true,
      signal: abortController.signal,  // [NEW] Pass abort signal
    });

    for await (const part of stream) {
      const text = part.choices?.[0]?.delta?.content || '';
      if (text) {
        sendEvent('message', { text });
      }
    }

    sendEvent('end', {});
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('LLM request aborted successfully');
    } else {
      console.error('OpenAI streaming error:', error);
      sendEvent('error', { message: 'Terjadi kesalahan saat memanggil model.' });
    }
  } finally {
    res.end();
  }
};
```

**Benefit:**
- ✅ LLM request di-abort saat client disconnect
- ✅ Hemat token API
- ✅ Server resources di-release lebih cepat

**Testing:**
```bash
# Terminal 1: Start server
node server.js

# Terminal 2: Monitor server logs
tail -f server.log

# Browser: Start streaming → Stop
# Expected log: "Client disconnected, aborting LLM request"
```

### 2. Token Counter

**Frontend (`stop_streaming_response.njk`):**
```html
<!-- Add di section output -->
<section style="margin-top: 2rem;">
  <h2>Streaming Response</h2>
  <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
    <span>Output:</span>
    <span id="token-counter" style="font-size: 0.9em; color: #666;">
      Tokens: 0
    </span>
  </div>
  <div id="stop-stream-output" class="stream-output"></div>
</section>
```

```javascript
// Di event listener 'message'
source.addEventListener('message', (messageEvent) => {
  try {
    const payload = JSON.parse(messageEvent.data);
    if (payload.text) {
      buffer += payload.text;
      renderWithMarked(buffer);

      // [NEW] Update token counter
      const roughTokenCount = buffer.split(/\s+/).length;
      document.getElementById('token-counter').textContent =
        `Tokens: ~${roughTokenCount}`;
    }
  } catch (error) {
    console.error('Gagal mem-parsing streaming:', error);
  }
});
```

### 3. Progress Bar

```html
<div class="progress-container" style="display: none;">
  <div class="progress-bar">
    <div id="progress-fill" class="progress-fill"></div>
  </div>
  <span id="progress-text">0%</span>
</div>

<style>
.progress-container {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: #e0e7ff;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #4338ca);
  width: 0%;
  transition: width 0.3s ease;
}
</style>
```

```javascript
// Estimasi progress berdasarkan max_tokens
const MAX_TOKENS = 4096;  // Dari .env

source.addEventListener('message', (messageEvent) => {
  const payload = JSON.parse(messageEvent.data);
  if (payload.text) {
    buffer += payload.text;
    renderWithMarked(buffer);

    const currentTokens = buffer.split(/\s+/).length;
    const progress = Math.min((currentTokens / MAX_TOKENS) * 100, 100);

    document.getElementById('progress-fill').style.width = `${progress}%`;
    document.getElementById('progress-text').textContent = `${Math.round(progress)}%`;
  }
});
```

### 4. Save Partial Response

```javascript
// Add button di UI
<button type="button" id="save-output" class="button-secondary">
  💾 Save Output
</button>

// Event handler
document.getElementById('save-output').addEventListener('click', () => {
  if (!buffer) {
    alert('Tidak ada output untuk disimpan');
    return;
  }

  const blob = new Blob([buffer], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `llm-output-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
});
```

### 5. Resume Streaming (Advanced)

**Concept:** Lanjutkan streaming dari titik terakhir

**Implementation:**

```javascript
let lastCompletionId = null;

// Saat stop
stopButton.addEventListener('click', () => {
  status.textContent = 'Streaming dihentikan.';
  closeSource();
  submitButton.disabled = false;

  // [NEW] Enable resume button
  document.getElementById('resume-button').disabled = false;
});

// Resume handler
document.getElementById('resume-button').addEventListener('click', () => {
  const params = new URLSearchParams({
    prompt: promptInput.value.trim(),
    reasoning: reasoningToggle.checked ? 'on' : 'off',
    continue_from: buffer,  // Send existing buffer
  });

  source = new EventSource(`/api/stop-streaming?${params.toString()}`);
  // ... attach listeners
});
```

**Backend:**
```javascript
const streamResponse = async (req, res) => {
  const prompt = req.query.prompt;
  const continueFrom = req.query.continue_from || '';

  const systemPrompt = /* ... */;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  if (continueFrom) {
    messages.push(
      { role: 'assistant', content: continueFrom },
      { role: 'user', content: 'Please continue from where you left off.' }
    );
  }

  // ... rest of streaming logic
};
```

### 6. Keyboard Shortcuts

```javascript
// ESC = Stop streaming
// Ctrl+Enter = Submit
document.addEventListener('keydown', (e) => {
  // Stop dengan ESC
  if (e.key === 'Escape' && !stopButton.disabled) {
    stopButton.click();
  }

  // Submit dengan Ctrl+Enter
  if (e.ctrlKey && e.key === 'Enter' && !submitButton.disabled) {
    form.dispatchEvent(new Event('submit'));
  }
});
```

### 7. Auto-Stop After N Tokens

```javascript
const AUTO_STOP_THRESHOLD = 1000;  // Stop after 1000 tokens

source.addEventListener('message', (messageEvent) => {
  const payload = JSON.parse(messageEvent.data);
  if (payload.text) {
    buffer += payload.text;

    const tokenCount = buffer.split(/\s+/).length;
    if (tokenCount >= AUTO_STOP_THRESHOLD) {
      console.log(`Auto-stopping at ${tokenCount} tokens`);
      closeSource();
      status.textContent = `Streaming dihentikan otomatis (${tokenCount} tokens).`;
      submitButton.disabled = false;
    } else {
      renderWithMarked(buffer);
    }
  }
});
```

---

## Lisensi dan Kontribusi

**Repository:** https://github.com/algonacci/llm_technique

Untuk pertanyaan atau bug report, silakan buat issue di repository GitHub.

---

## Referensi Silang

Untuk pemahaman lebih mendalam tentang implementasi shared:
- **Architecture & Shared Components**: Lihat `ON_OFF_REASONING.md`
- **SSE Protocol Details**: Lihat `ON_OFF_REASONING.md` > "Alur Data Streaming"
- **Rendering Logic**: Lihat `ON_OFF_REASONING.md` > "Komponen Frontend > 2. Rendering Logic"
- **Environment Configuration**: Lihat `ON_OFF_REASONING.md` > "Konfigurasi Environment"
