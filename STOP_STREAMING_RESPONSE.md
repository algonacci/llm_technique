## Stop Streaming Response Page

Halaman **Stop Streaming Response** fokus pada skenario menghentikan output LLM yang panjang secara manual agar pengguna dapat segera memberi instruksi baru.

---

### Gambaran Fitur

- **Prompt Form & Toggle**  
  Antarmuka identik dengan halaman ON/OFF Reasoning: textarea, toggle reasoning, dan tombol aksi. Toggle mengontrol apakah reasoning `<think>` dirender.

- **Tombol Stop**  
  - Diaktifkan setelah SSE dibuka (`Mulai Streaming` ditekan).  
  - Menutup koneksi `EventSource`, menampilkan status *“Streaming dihentikan”*, dan mengaktifkan ulang tombol submit.

- **Panel Streaming**  
  - Reasoning ditampilkan dalam `<details>` collapsible (dengan caret animasi) jika toggle ON.
  - Ketika toggle OFF, reasoning diabaikan sampai tag `</think>` diterima; hanya jawaban final yang ditampilkan.

---

### Endpoint Backend

Endpoint menggunakan handler generik yang juga dipakai halaman reasoning:

```js
app.get('/api/stop-streaming', streamResponse);
```

`streamResponse`:

1. Memastikan `prompt`, `LLM_BASE_URL`, dan `LLM_API_KEY` tersedia.
2. Mengirim header SSE dan event `config` (`{ reasoningMode, source: req.path }`).
3. Membuat permintaan streaming ke LLM dengan `openai.chat.completions.create({ stream: true })`.
4. Meneruskan delta konten ke klien melalui event `message`.
5. Mengirim `end` saat aliran selesai atau `error` jika terjadi kegagalan.

Karena handler bersifat re-usable, halaman ini otomatis mendapat dukungan toggle reasoning dan format streaming yang sama tanpa duplikasi kode server.

---

### Detail Rendering Klien

- Buffer teks disimpan di memori browser, sehingga ketika toggle reasoning diubah setelah streaming selesai, tampilan segera diperbarui tanpa memanggil ulang server.
- Fungsi render memisahkan tiga bagian:
  1. Prefix sebelum `<think>` (bila ada).
  2. Reasoning di antara `<think>` dan `</think>` (hanya tampil ketika toggle ON).
  3. Jawaban akhir setelah `</think>`.
- Markdown dirender melalui `marked` sehingga teks kaya (emoji, list, code) tetap terlihat baik.

---

### Cara Mencoba

```bash
node server.js
# Buka http://localhost:3000/stop_streaming_response
```

1. Isi prompt panjang, tekan **Mulai Streaming**.  
2. Setelah beberapa token muncul, tekan **Stop**. UI menutup SSE dan pemanggilan berikutnya bisa segera dilakukan.  
3. Ulangi dengan toggle reasoning ON/OFF untuk melihat perbedaan tampilan.

---

### Ide Pengembangan Lanjutan

- Mengirim event `stop` ke server agar backend ikut menghentikan request ke model (membutuhkan dukungan cancel/abort di SDK).
- Menambahkan indikator progress (mis. jumlah token diterima).
- Menyediakan tombol “Lanjutkan” untuk meneruskan streaming dari titik terakhir bila model mendukung.
