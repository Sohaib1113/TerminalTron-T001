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

export default async function taskRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const tasks = await prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { parent: true },
    });
    return { tasks };
  });

  app.post('/', async (request, reply) => {
    const { title, description, priority, dueDate } = request.body as {
      title: string;
      description?: string;
      priority?: string;
      dueDate?: string;
    };

    if (!title) {
      reply.status(400);
      return { error: 'Task title is required' };
    }

    const user = await getDefaultUser();

    const task = await prisma.task.create({
      data: {
        userId: user.id,
        title,
        description: description ?? '',
        priority: priority ?? 'medium',
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    return { task };
  });
}
