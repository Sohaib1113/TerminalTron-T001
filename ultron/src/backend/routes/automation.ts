import { FastifyInstance } from 'fastify';
import automationService, { AutomationAction, AutomationIntent } from '../services/automationService';

/**
 * Maps a raw action string + target into a validated intent, reusing the
 * service's natural-language parser for free-form prompts.
 */
const resolveIntent = (action: string, target: string): AutomationIntent => {
  const parsed = automationService.parseAutomationIntent(`/automate ${action} ${target}`);
  if (!parsed) {
    throw new Error(`Unsupported automation action: ${action}`);
  }
  return parsed;
};

export default async function automationRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const [tasks, stats, capabilities] = await Promise.all([
      automationService.listTasks(50),
      automationService.getStats(),
      automationService.getCapabilities(),
    ]);
    return { tasks, stats, capabilities };
  });

  app.get('/capabilities', async () => ({ capabilities: automationService.getCapabilities() }));

  app.get('/stats', async () => ({ stats: await automationService.getStats() }));

  app.get('/tasks', async () => ({ tasks: await automationService.listTasks(50) }));

  app.get('/pending', async () => ({ tasks: await automationService.listPending() }));

  app.get('/audit', async (request) => {
    const { limit } = request.query as { limit?: string };
    return { logs: await automationService.listAudit(limit ? Number(limit) : 100) };
  });

  /**
   * Creates a pending task. Accepts either a natural-language prompt (which is
   * parsed for intent) or an explicit action + target pair. Always waits for
   * user approval before executing.
   */
  app.post('/request', async (request, reply) => {
    const { prompt, action, target, source } = request.body as {
      prompt?: string;
      action?: string;
      target?: string;
      source?: string;
    };

    try {
      let intent: AutomationIntent | null = null;
      if (prompt) {
        intent = automationService.parseAutomationIntent(prompt);
      } else if (action) {
        intent = resolveIntent(action, target ?? '');
      }

      if (!intent) {
        reply.status(400);
        return { error: 'No automatable intent detected in the request.' };
      }

      const task = await automationService.createTask(intent, source ?? 'manual');
      return { task };
    } catch (error) {
      reply.status(400);
      return { error: error instanceof Error ? error.message : 'Failed to create automation task' };
    }
  });

  /** Approves a pending task and executes the action. */
  app.post('/tasks/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const task = await automationService.approveTask(id);
      return { task };
    } catch (error) {
      reply.status(400);
      return { error: error instanceof Error ? error.message : 'Failed to approve task' };
    }
  });

  /** Denies a pending task. */
  app.post('/tasks/:id/deny', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const task = await automationService.denyTask(id);
      return { task };
    } catch (error) {
      reply.status(400);
      return { error: error instanceof Error ? error.message : 'Failed to deny task' };
    }
  });

  /** Creates and immediately executes an action (explicit user intent). */
  app.post('/execute', async (request, reply) => {
    const { action, target, prompt } = request.body as {
      action?: string;
      target?: string;
      prompt?: string;
    };

    try {
      let intent: AutomationIntent | null = null;
      if (prompt) {
        intent = automationService.parseAutomationIntent(prompt);
      } else if (action) {
        intent = resolveIntent(action as AutomationAction, target ?? '');
      }

      if (!intent) {
        reply.status(400);
        return { error: 'No automatable intent detected in the request.' };
      }

      const pending = await automationService.createTask(intent, 'api');
      const task = await automationService.approveTask(pending.id);
      return { task };
    } catch (error) {
      reply.status(400);
      return { error: error instanceof Error ? error.message : 'Failed to execute automation' };
    }
  });

  app.delete('/history', async () => {
    const result = await automationService.clearHistory();
    return result;
  });
}