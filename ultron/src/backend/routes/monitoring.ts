import { FastifyInstance } from 'fastify';
import prisma from '../db';
import monitoringService from '../services/monitoringService';

const getDefaultUser = async () => {
  return prisma.user.upsert({
    where: { username: 'ultron-system' },
    update: {},
    create: {
      username: 'ultron-system',
      email: 'ultron@local',
      password: '',
    },
  });
};

export default async function monitoringRoutes(app: FastifyInstance) {
  app.get('/metrics', async (request) => {
    const { limit } = request.query as { limit?: string };
    const take = Math.min(Math.max(Number(limit) || 30, 1), 500);

    const metrics = await prisma.systemMetrics.findMany({
      orderBy: { timestamp: 'desc' },
      take,
    });

    return { metrics: metrics.reverse() };
  });

  app.get('/metrics/latest', async () => {
    const metric = await prisma.systemMetrics.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    return { metric };
  });

  app.get('/alerts', async () => {
    const user = await getDefaultUser();

    const alerts = await prisma.monitoringAlert.findMany({
      where: { userId: user.id },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });

    return { alerts };
  });

  app.patch('/alerts/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };

    let alert;
    try {
      alert = await prisma.monitoringAlert.update({
        where: { id },
        data: { read: true },
      });
    } catch (error) {
      reply.status(404);
      return { error: 'Alert not found' };
    }

    return { alert };
  });

  app.post('/check', async () => {
    const snapshot = await monitoringService.takeSnapshot({ persist: true });
    return { snapshot };
  });
}