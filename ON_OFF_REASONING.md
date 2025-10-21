## ON/OFF Reasoning Page

Halaman **ON/OFF Reasoning** mendemonstrasikan bagaimana mengonsumsi model LLM secara streaming dengan kontrol penuh terhadap tampilan _chain-of-thought_ (`<think>...</think>`) di sisi klien.

---

### Arsitektur Singkat

| Komponen | Peran |
| --- | --- |
| `views/on_off_reasoning.njk` | UI berbasis Nunjucks yang merender form prompt, toggle reasoning, tombol Stop, dan panel streaming. |
| `server.js` (`/api/reasoning`) | Endpoint SSE yang meneruskan prompt ke model dan mem-stream delta token. |
| OpenAI SDK | Dipakai sebagai klien HTTP generic ke LLM dengan konfigurasi `LLM_BASE_URL` dan `LLM_API_KEY`. |

---

### Alur Streaming

1. Pengguna memasukkan prompt dan menekan `Kirim ke Model`.
2. Frontend membuka `EventSource` ke `/api/reasoning?prompt=...&reasoning=on|off`.
3. Server mengirim event SSE:
   - `config`: mengabarkan mode reasoning yang diterapkan.
   - `message`: potongan teks (`delta`) dari model.
   - `end`: sinyal selesai.
   - `error`: pesan kegagalan (jika ada).
4. Klien menampung potongan teks ke buffer, memeriksa keberadaan `<think>` dan `</think>`, lalu merender ulang UI secara progresif.

---

### Perilaku UI

- **Toggle Reasoning**  
  - ON: Reasoning dibungkus `<details>` yang otomatis terbuka. Selama `</think>` belum diterima, teks reasoning ditampilkan sebagai animasi pengetikan dengan kursor berkedip.
  - OFF: Seluruh konten `<think>` diabaikan sampai tag penutup diterima. Hanya jawaban final yang dirender.

- **Tombol Stop**  
  - Aktif selama SSE berjalan. Menutup koneksi dan menyalakan kembali tombol submit sehingga pengguna bisa mengirim prompt baru tanpa menunggu streaming selesai.

- **Rendering Markdown**  
  - Library `marked` mengubah teks final menjadi HTML. Ini memungkinkan heading, list, atau code block tampil rapi.

---

### Penanganan Back-end

```js
const streamResponse = async (req, res) => {
  const reasoningMode = req.query.reasoning === 'off' ? 'off' : 'on';
  const systemPrompt =
    reasoningMode === 'off'
      ? '...Do not generate <think> tags.'
      : '...include your reasoning inside <think>...</think>...';

  const stream = await openai.chat.completions.create({
    model: process.env.LLM_MODEL_NAME,
    messages: [...],
    stream: true,
  });

  for await (const part of stream) {
    sendEvent('message', { text: part.choices?.[0]?.delta?.content || '' });
  }
};
```

- `sendEvent` menulis payload SSE manual (karena Express tidak memiliki middleware SSE bawaan).
- Semua konfigurasi LLM diambil dari `.env`: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_NAME`, `LLM_MAX_TOKENS`.

---

### Pengujian Manual

```bash
npm install      # hanya sekali
node server.js   # jalankan server
# Buka http://localhost:3000/on_off_reasoning
```

Cobalah:
1. Reasoning ON → prompt panjang → amati blok reasoning yang mengetik.  
2. Tekan `Stop` di tengah streaming.  
3. Reasoning OFF → kirim prompt baru → hanya jawaban akhir yang tampil.

---

### Pengembangan Lanjutan

- Menambahkan opsi model dinamis (dropdown yang mengisi query string `model`).
- Menyimpan riwayat percakapan per sesi (mis. localStorage atau backend).
- Menunjukkan token usage bila API menyediakan metrik tersebut.
