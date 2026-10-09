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

export default async function conversationRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const user = await getDefaultUser();
    const conversations = await prisma.conversation.findMany({
      where: { userId: user.id },
      include: { messages: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    return { conversations };
  });

  app.post('/', async (request, reply) => {
    const { title, description, prompt } = request.body as {
      title: string;
      description?: string;
      prompt?: string;
    };

    if (!title) {
      reply.status(400);
      return { error: 'Conversation title is required' };
    }

    const user = await getDefaultUser();
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        title,
        description: description ?? '',
      },
    });

    if (prompt) {
      await prisma.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: prompt,
        },
      });
    }

    return { conversation };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { timestamp: 'asc' } } },
    });

    if (!conversation) {
      reply.status(404);
      return { error: 'Conversation not found' };
    }

    return { conversation };
  });
}
