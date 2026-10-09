import { FastifyInstance } from 'fastify';
import { ollamaRuntime } from '../services/ollamaRuntime';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Reports how the offline LLM runtime was resolved: reused an existing
  // Ollama, started the bundled one, or is unavailable.
  app.get('/ollama', async () => ollamaRuntime.getStatus());
}
