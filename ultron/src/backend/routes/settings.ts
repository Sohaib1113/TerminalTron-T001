import { FastifyInstance } from 'fastify';
import prisma from '../db';

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

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const user = await getDefaultUser();
    const settings = await prisma.appSettings.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
      },
    });

    return { settings };
  });

  app.put('/', async (request, reply) => {
    const user = await getDefaultUser();
    const payload = request.body as Partial<Record<string, unknown>>;

    const settings = await prisma.appSettings.update({
      where: { userId: user.id },
      data: {
        theme: typeof payload.theme === 'string' ? payload.theme : undefined,
        autoStart: typeof payload.autoStart === 'boolean' ? payload.autoStart : undefined,
        notificationsEnabled: typeof payload.notificationsEnabled === 'boolean' ? payload.notificationsEnabled : undefined,
        soundEnabled: typeof payload.soundEnabled === 'boolean' ? payload.soundEnabled : undefined,
        llmProvider: typeof payload.llmProvider === 'string' ? payload.llmProvider : undefined,
        llmModel: typeof payload.llmModel === 'string' ? payload.llmModel : undefined,
        llmApiKey: typeof payload.llmApiKey === 'string' ? payload.llmApiKey : undefined,
        ollamaBaseUrl: typeof payload.ollamaBaseUrl === 'string' ? payload.ollamaBaseUrl : undefined,
        monitoringEnabled: typeof payload.monitoringEnabled === 'boolean' ? payload.monitoringEnabled : undefined,
        monitoringInterval: typeof payload.monitoringInterval === 'number' ? payload.monitoringInterval : undefined,
        sidebarCollapsed: typeof payload.sidebarCollapsed === 'boolean' ? payload.sidebarCollapsed : undefined,
        defaultView: typeof payload.defaultView === 'string' ? payload.defaultView : undefined,
      },
    });

    return { settings };
  });
}
