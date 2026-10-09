import { FastifyInstance } from 'fastify';
import prisma from '../db';
import llmService, { ConversationMessageInput } from '../services/llmService';
import automationService from '../services/automationService';
import { transcribeWavBuffer } from '../services/sttService';
import { getSpeechVocabulary } from '../services/automationService';

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

const ensureConversation = async (userId: string, prompt: string, conversationId?: string) => {
  if (conversationId) {
    return prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }

  return prisma.conversation.create({
    data: {
      userId,
      title: prompt.trim().slice(0, 60) || 'New conversation',
      description: '',
    },
  });
};

const writeMessage = async (conversationId: string, role: string, content: string) => {
  return prisma.conversationMessage.create({
    data: { conversationId, role, content },
  });
};

const getRecentContext = async (conversationId: string): Promise<ConversationMessageInput[]> => {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { timestamp: 'desc' },
    take: 16,
  });

  return rows.reverse().map((row) => ({
    role:
      row.role === 'user' || row.role === 'assistant' || row.role === 'system'
        ? row.role
        : 'user',
    content: row.content,
  }));
};

const toFriendlyError = async (error: unknown): Promise<string> => {
  const message = error instanceof Error ? error.message : 'Unknown AI error';

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up|econnreset/i.test(message)) {
    const settings = await llmService.getSettings();
    return `Cannot reach ${settings.provider} at ${settings.baseUrl}. Start it (e.g. run "ollama serve") or check Settings → AI/LLM.`;
  }

  return message;
};

/**
 * Detects an automation intent (explicit /automate command or natural-language
 * request). Returns null for ordinary conversational turns. Never executes on
 * its own — the caller is responsible for user approval gating.
 */
const detectAutomation = (prompt: string) => {
  if (!automationService.isEnabled()) {
    return null;
  }
  return automationService.parseAutomationIntent(prompt);
};

/**
 * LLM fallback for phrasings the deterministic parser misses. The extracted
 * intent is re-validated through the same allowlist/danger parsers, so the LLM
 * can never widen what the assistant may do — it only improves understanding.
 * Returns null when there is no clear machine-action intent.
 */
const detectAutomationWithLlmFallback = async (prompt: string) => {
  const direct = detectAutomation(prompt);
  if (direct) {
    return direct;
  }
  if (!automationService.isEnabled()) {
    return null;
  }
  const extracted = await llmService.extractAutomationIntent(
    prompt,
    25000,
    automationService.getSpeechVocabulary(),
  );
  if (!extracted) {
    return null;
  }
  // open_site encodes its browser as "site|browser" — reattach it so
  // "open netflix on brave" keeps its browser when routed via the LLM fallback.
  const target =
    extracted.action === 'open_site' && extracted.browser
      ? `${extracted.target}|${extracted.browser}`
      : extracted.target;
  return automationService.buildIntentFromAction(extracted.action, target);
};

export default async function aiRoutes(app: FastifyInstance) {
  app.post('/prompt', async (request, reply) => {
    const { prompt, conversationId } = request.body as {
      prompt: string;
      conversationId?: string;
    };

    if (!prompt) {
      reply.status(400);
      return { error: 'Prompt is required' };
    }

    try {
      const user = await getDefaultUser();
      const conversation = await ensureConversation(user.id, prompt, conversationId);

      const history = await getRecentContext(conversation.id);

      await writeMessage(conversation.id, 'user', prompt);

      const intent = await detectAutomationWithLlmFallback(prompt);
      if (intent) {
        const task = await automationService.createTask(intent, 'chat');
        const message = `I can ${intent.detail.charAt(0).toLowerCase()}${intent.detail.slice(1)}. Awaiting your approval.`;
        await writeMessage(conversation.id, 'assistant', message);
        return {
          result: { text: message, model: 'automation', provider: 'ultron', durationMs: 0 },
          conversationId: conversation.id,
          automation: task,
        };
      }

      const unsupported = automationService.describeUnsupportedIntent(prompt);
      if (unsupported) {
        await writeMessage(conversation.id, 'assistant', unsupported);
        return {
          result: { text: unsupported, model: 'automation', provider: 'ultron', durationMs: 0 },
          conversationId: conversation.id,
        };
      }

      const result = await llmService.generate(prompt, { history });

      await writeMessage(conversation.id, 'assistant', result.text);

      return { result, conversationId: conversation.id };
    } catch (error) {
      reply.status(500);
      const message = await toFriendlyError(error);
      return { error: message };
    }
  });

  app.post('/prompt/stream', async (request, reply) => {
    const { prompt, conversationId } = request.body as {
      prompt: string;
      conversationId?: string;
    };

    if (!prompt) {
      reply.status(400);
      return { error: 'Prompt is required' };
    }

    let conversation;
    let history: ConversationMessageInput[] = [];
    try {
      const user = await getDefaultUser();
      conversation = await ensureConversation(user.id, prompt, conversationId);
      history = await getRecentContext(conversation.id);
      await writeMessage(conversation.id, 'user', prompt);
    } catch (error) {
      reply.status(500);
      const message = error instanceof Error ? error.message : 'Failed to persist conversation';
      return { error: message };
    }

    reply.hijack();
    const raw = reply.raw;
    // Add CORS header for frontend compatibility
    raw.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    raw.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    raw.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, accept, origin, x-requested-with');
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('start', { conversationId: conversation.id });

    const streamIntent = await detectAutomationWithLlmFallback(prompt);
    if (streamIntent) {
      try {
        const task = await automationService.createTask(streamIntent, 'chat');
        const message = `I can ${streamIntent.detail.charAt(0).toLowerCase()}${streamIntent.detail.slice(1)}. Approve to proceed.`;
        send('automation', { task, message });
        await writeMessage(conversation.id, 'assistant', message);
        send('done', { conversationId: conversation.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to prepare automation';
        send('error', { error: message });
      } finally {
        raw.end();
      }
      return;
    }

    const unsupportedHint = automationService.describeUnsupportedIntent(prompt);
    if (unsupportedHint) {
      try {
        send('chunk', { text: unsupportedHint });
        await writeMessage(conversation.id, 'assistant', unsupportedHint);
        send('done', { conversationId: conversation.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to persist response';
        send('error', { error: message });
      } finally {
        raw.end();
      }
      return;
    }

    let fullText = '';
    try {
      for await (const chunk of llmService.stream(prompt, { history })) {
        fullText += chunk;
        send('chunk', { text: chunk });
      }
    } catch (error) {
      const message = await toFriendlyError(error);
      send('error', { error: message });
      raw.end();
      return;
    }

    try {
      await writeMessage(conversation.id, 'assistant', fullText);
      send('done', { conversationId: conversation.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to persist response';
      send('error', { error: message });
    } finally {
      raw.end();
    }
  });

  app.get('/status', async () => {
    const status = await llmService.getStatus();
    return { status };
  });

  /**
   * Offline speech-to-text for the desktop app: the renderer sends a recorded
   * 16 kHz mono WAV (base64) and Windows' built-in recogniser transcribes it
   * locally. Body limit raised to fit ~30s of audio.
   */
  app.post('/transcribe', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const { audio } = request.body as { audio?: string };
    if (!audio || typeof audio !== 'string') {
      reply.status(400);
      return { error: 'audio (base64 WAV) is required' };
    }

    let wav: Buffer;
    try {
      wav = Buffer.from(audio, 'base64');
    } catch {
      reply.status(400);
      return { error: 'audio is not valid base64' };
    }

    try {
      const text = await transcribeWavBuffer(wav, getSpeechVocabulary());
      return { text };
    } catch (error) {
      reply.status(500);
      const message = error instanceof Error ? error.message : 'Transcription failed';
      return { error: message };
    }
  });

  app.get('/models', async (request, reply) => {
    const settings = await llmService.getSettings();

    if (settings.provider !== 'ollama') {
      return {
        models: [],
        connected: false,
        baseUrl: settings.baseUrl,
        provider: settings.provider,
      };
    }

    try {
      const models = await llmService.listModels(settings.baseUrl);
      return { models, connected: true, baseUrl: settings.baseUrl, provider: settings.provider };
    } catch (error) {
      reply.status(502);
      const message = await toFriendlyError(error);
      return {
        models: [],
        connected: false,
        baseUrl: settings.baseUrl,
        provider: settings.provider,
        error: message,
      };
    }
  });
}
