import { FastifyInstance } from 'fastify';
import { ollamaRuntime } from '../services/ollamaRuntime';
import { ttsRuntime } from '../services/ttsService';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Reports how the offline LLM runtime was resolved: reused an existing
  // Ollama, started the bundled one, or is unavailable.
  app.get('/ollama', async () => ollamaRuntime.getStatus());

  // Cinematic cloned-voice (XTTS-v2) runtime status.
  app.get('/tts', async () => ttsRuntime.getStatus());

  // Synthesize Ultron's cloned voice for `text`. Returns WAV audio bytes, or a
  // 503 when the runtime is unavailable so the renderer can fall back to the
  // browser's Web Speech voice.
  app.post('/tts/speak', async (request, reply) => {
    const { text, speed } = request.body as { text?: string; speed?: number };
    if (!text || typeof text !== 'string') {
      reply.status(400);
      return { error: 'text is required' };
    }
    const wav = await ttsRuntime.synthesize(text, typeof speed === 'number' ? speed : 1.0);
    if (!wav) {
      reply.status(503);
      return { error: 'XTTS voice runtime unavailable', status: ttsRuntime.getStatus() };
    }
    reply.header('Content-Type', 'audio/wav');
    reply.header('Content-Length', String(wav.length));
    return reply.send(wav);
  });

  // Streaming PCM: forwards XTTS's chunked audio so the renderer can start
  // playing within seconds instead of after the whole reply is generated.
  app.post('/tts/stream', async (request, reply) => {
    const { text, speed } = request.body as { text?: string; speed?: number };
    if (!text || typeof text !== 'string') {
      reply.status(400);
      return { error: 'text is required' };
    }
    const upstream = await ttsRuntime.startStream(text, typeof speed === 'number' ? speed : 1.0);
    if (!upstream || !upstream.body) {
      reply.status(503);
      return { error: 'XTTS voice runtime unavailable', status: ttsRuntime.getStatus() };
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'X-Audio-Format': 'pcm_s16le',
      'X-Sample-Rate': String(ttsRuntime.sampleRate),
      'X-Channels': '1',
      'Cache-Control': 'no-cache',
    });
    // Pipe the upstream chunked body straight through to the browser.
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      reply.raw.write(value);
    }
    reply.raw.end();
    return reply;
  });
}
