require('dotenv').config();
const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
const VIEWS_DIR = path.join(__dirname, 'views');
const SERVER_URL = `http://localhost:${PORT}`;
const openai = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

// Configure Nunjucks templating with watch enabled for live reload.
nunjucks.configure(VIEWS_DIR, {
  autoescape: true,
  express: app,
  watch: true,
});

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

const streamResponse = async (req, res) => {
  const prompt = req.query.prompt;
  const reasoningMode = req.query.reasoning === 'off' ? 'off' : 'on';

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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

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
    const stream = await openai.chat.completions.create({
      model: process.env.LLM_MODEL_NAME || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
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
    console.error('OpenAI streaming error:', error);
    sendEvent('error', { message: 'Terjadi kesalahan saat memanggil model.' });
  } finally {
    res.end();
  }
};

app.get('/api/reasoning', streamResponse);
app.get('/api/stop-streaming', streamResponse);

app.listen(PORT, () => {
  console.log(`Server listening on ${SERVER_URL}`);
});
