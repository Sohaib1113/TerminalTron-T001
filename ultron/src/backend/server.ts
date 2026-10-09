import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import routes from './routes';
import monitoringService from './services/monitoringService';

dotenv.config();

const app = Fastify({ logger: true });

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
