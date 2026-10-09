import { FastifyInstance } from 'fastify';
import healthRoutes from './health';
import taskRoutes from './tasks';
import aiRoutes from './ai';
import conversationRoutes from './conversations';
import settingsRoutes from './settings';
import monitoringRoutes from './monitoring';
import automationRoutes from './automation';

export default async function routes(app: FastifyInstance) {
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(taskRoutes, { prefix: '/tasks' });
  await app.register(aiRoutes, { prefix: '/ai' });
  await app.register(conversationRoutes, { prefix: '/conversations' });
  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(monitoringRoutes, { prefix: '/monitoring' });
  await app.register(automationRoutes, { prefix: '/automation' });
}
