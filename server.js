require('dotenv').config();
const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const { OpenAI: LLMClient } = require('openai');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const VIEWS_DIR = path.join(__dirname, 'views');
const SERVER_URL = `http://localhost:${PORT}`;
const llmClient = new LLMClient({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const IMAGE_TTL_MS = Number(process.env.UPLOAD_TTL_MS) || 60_000;

// Configure Nunjucks templating with watch enabled for live reload.
nunjucks.configure(VIEWS_DIR, {
  autoescape: true,
  express: app,
  watch: true,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024,
  },
});
const uploadedImages = new Map();

setInterval(() => {
  const expiration = Date.now() - IMAGE_TTL_MS;
  for (const [id, record] of uploadedImages.entries()) {
    if (record.createdAt < expiration) {
      uploadedImages.delete(id);
    }
  }
}, IMAGE_TTL_MS).unref?.();

app.set('view engine', 'njk');
app.set('views', VIEWS_DIR);

app.get('/', (req, res) => {
  res.render('home', {
    pageId: 'home',
    serverUrl: SERVER_URL,
  });
});

app.get('/on_off_reasoning', (req, res) => {
  res.render('on_off_reasoning', {
    pageId: 'on_off_reasoning',
  });
});

app.get('/stop_streaming_response', (req, res) => {
  res.render('stop_streaming_response', {
    pageId: 'stop_streaming_response',
  });
});

app.get('/upload_image', (req, res) => {
  res.render('upload_image', {
    pageId: 'upload_image',
  });
});

app.post('/api/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'File gambar diperlukan.' });
    return;
  }

  const imageId = crypto.randomUUID();
  uploadedImages.set(imageId, {
    data: req.file.buffer.toString('base64'),
    mimeType: req.file.mimetype || 'image/png',
    createdAt: Date.now(),
  });

  res.json({ imageId });
});

const streamResponse = async (req, res) => {
  const prompt = req.query.prompt;
  const reasoningMode = req.query.reasoning === 'off' ? 'off' : 'on';
  const imageId = req.query.imageId;

  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  if (!process.env.LLM_API_KEY) {
    res.status(500).json({ error: 'LLM API key belum dikonfigurasi.' });
    return;
  }

  if (!process.env.LLM_BASE_URL) {
    res.status(500).json({ error: 'LLM base URL belum dikonfigurasi.' });
    return;
  }

  let modelName = (process.env.LLM_MODEL_NAME || '').trim();
  const supportsVision =
    (process.env.LLM_SUPPORTS_VISION || '').toLowerCase() === 'true';

  let userMessage = {
    role: 'user',
    content: prompt,
  };

  if (imageId) {
    const imageRecord = uploadedImages.get(imageId);

    if (!imageRecord) {
      res.status(400).json({ error: 'Gambar tidak ditemukan atau kadaluwarsa.' });
      return;
    }

    if (supportsVision) {
      userMessage = {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${imageRecord.mimeType};base64,${imageRecord.data}`,
            },
          },
        ],
      };

    } else {
      const approxBytes = Math.ceil((imageRecord.data.length * 3) / 4);
      userMessage = {
        role: 'user',
        content: `${prompt}\n\n---\nGambar dikodekan dalam Base64 (${imageRecord.mimeType}, ~${approxBytes} byte):\n${imageRecord.data}`,
      };
    }
  }

  if (!modelName) {
    res.status(500).json({ error: 'LLM model belum dikonfigurasi.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  req.on('close', () => {
    if (imageId) {
      uploadedImages.delete(imageId);
    }
  });

  const sendEvent = (event, data) => {
    const payload = data !== undefined ? `data: ${JSON.stringify(data)}\n\n` : '\n';
    res.write(event ? `event: ${event}\n${payload}` : payload);
  };

  sendEvent('config', { reasoningMode, source: req.path });

  const systemPrompt =
    reasoningMode === 'off'
      ? 'You are a helpful assistant. Respond directly to the user without revealing your chain-of-thought. Do not generate <think> tags.'
      : 'You are a helpful assistant. You may think through the task and include your reasoning inside <think>...</think> before the final answer.';

  try {
    const stream = await llmClient.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        userMessage,
      ],
      max_tokens: Number(process.env.LLM_MAX_TOKENS) || 4096,
      stream: true,
    });

    for await (const part of stream) {
      const text = part.choices?.[0]?.delta?.content || '';
      if (text) {
        sendEvent('message', { text });
      }
    }

    sendEvent('end', {});
  } catch (error) {
    const errorDetails =
      error?.error?.message ||
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'Terjadi kesalahan saat memanggil model.';

    console.error('LLM streaming error:', error);
    sendEvent('error', { message: errorDetails });
  } finally {
    if (imageId) {
      uploadedImages.delete(imageId);
    }
    res.end();
  }
};

app.get('/api/reasoning', streamResponse);
app.get('/api/stop-streaming', streamResponse);
app.get('/api/upload-streaming', streamResponse);

app.listen(PORT, () => {
  console.log(`Server listening on ${SERVER_URL}`);
});
