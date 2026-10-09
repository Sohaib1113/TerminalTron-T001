import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import routes from './routes';
import monitoringService from './services/monitoringService';
import { ollamaRuntime } from './services/ollamaRuntime';
import { ttsRuntime } from './services/ttsService';

dotenv.config();

const app = Fastify({ logger: true });

// Bring up the bundled (offline) Ollama runtime before serving requests, so the
// first chat message has a live model. Reuses an existing install if present.
ollamaRuntime
  .ensureRunning()
  .then((status) => {
    if (status.running) {
      app.log.info(
        `Ollama ready on ${status.baseUrl} (${status.reused ? 'reused existing' : 'bundled'}${status.modelPresent ? '' : ', model store missing'})`,
      );
    } else {
      app.log.warn(`Ollama not running: ${status.error ?? 'unknown'}`);
    }
  })
  .catch((error) => {
    app.log.error('Failed to start Ollama runtime', error);
  });

// Warm up the cloned-voice (XTTS-v2) runtime so the first spoken reply is ready.
// Reuses an already-running server if present; otherwise spawns the vendored one.
ttsRuntime
  .ensureRunning()
  .then((status) => {
    if (status.ready) {
      app.log.info(
        `Ultron voice ready on ${status.baseUrl} (${status.reused ? 'reused existing' : 'bundled'}${status.referencePresent ? '' : ', reference missing'})`,
      );
    } else {
      app.log.warn(`Ultron voice not ready: ${status.error ?? 'unknown'}`);
    }
  })
  .catch((error) => {
    app.log.error('Failed to start XTTS voice runtime', error);
  });

const startServer = async () => {
  await app.register(cors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'accept', 'origin', 'x-requested-with'],
    maxAge: 86400,
  });

  await app.register(routes, { prefix: '/api' });

  const port = Number(process.env.BACKEND_PORT || 5000);
  const host = '0.0.0.0';

  monitoringService.startMonitoring().catch((error) => {
    app.log.error('Failed to start monitoring', error);
  });

  try {
    await app.listen({ port, host });
    app.log.info(`Backend server running at http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

startServer();
