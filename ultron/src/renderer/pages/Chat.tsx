import { FormEvent, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  approveAutomationTask,
  denyAutomationTask,
  getAIStatus,
  getConversation,
  getConversations,
  getPendingAutomation,
  streamPrompt,
  transcribeAudio,
} from '../api';
import { AutomationTask, Conversation, ConversationMessage } from '../types';
import {
  isSpeechSupported,
  isVoiceEnabled,
  setVoiceEnabled,
  speakUltron,
  startStreamingSpeech,
  pushSpeechChunk,
  endStreamingSpeech,
  stopUltronSpeech,
} from '../voice';
import { PcmCapture, bytesToBase64, encodeWav16k, startPcmCapture } from '../mic';
import HoloEmblem from '../components/HoloEmblem';

type OrbMode = 'idle' | 'typing' | 'listening' | 'streaming' | 'speaking';

const ORB_LABELS: Record<OrbMode, string> = {
  idle: 'TerminalTron-T001 stands by',
  typing: 'TerminalTron-T001 awaits your words',
  listening: 'TerminalTron-T001 is listening…',
  streaming: 'TerminalTron-T001 is answering…',
  speaking: 'TerminalTron-T001 is speaking…',
};

/** Short replies that answer an on-screen "Approve & run" prompt. */
const APPROVAL_REPLY =
  /^(?:yes|yeah|yep|yup|y|ok|okay|k|sure|confirm|confirmed|approve|approved|do it|go ahead|go|proceed|run it|affirmative|absolutely)\b[.!\s]*$/i;
const DENIAL_REPLY =
  /^(?:no|nope|nah|n|cancel|stop|abort|deny|denied|don'?t|do not|nevermind|never mind)\b[.!\s]*$/i;

// Web Speech API is not part of lib.dom typings, so declare a minimal surface.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

const getSpeechRecognition = (): (new () => SpeechRecognitionLike) | null => {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/**
 * The desktop app runs in Electron, where Web Speech transcription is dead
 * (Chromium ships without Google's speech-service keys) — fall back to local
 * capture + the backend's offline Windows recogniser.
 */
const isElectronRuntime = (): boolean =>
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

/** Ultron speaker glyph — crossed out while the voice is muted. */
const SpeakerGlyph = (muted: boolean) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M3 9v6h4l5 4V5L7 9H3z" />
    {muted ? (
      <path
        d="M16.5 9.5l5 5m0-5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    ) : (
      <>
        <path
          d="M15.8 8.8a4.5 4.5 0 0 1 0 6.4"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M18.4 6.2a8 8 0 0 1 0 11.6"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </>
    )}
  </svg>
);

const ChatGlyph = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9H3v-9a9 9 0 0 1 9-9Zm-2.2 5.1a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm4.4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm-5 5.1a1 1 0 0 0 .1 1.9 4.3 4.3 0 0 0 5.4 0 1 1 0 1 0-1.2-1.6 2.3 2.3 0 0 1-3-.1 1 1 0 0 0-1.3-.2Z" />
  </svg>
);

const SearchGlyph = (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    aria-hidden="true"
  >
    <circle cx="10.8" cy="10.8" r="6.4" />
    <path d="m15.6 15.6 4 4" />
  </svg>
);

const BubbleGlyph = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M4.5 5h15v11H9.6L5 19.6V16H4.5z" />
  </svg>
);

const PlusGlyph = (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8.2v7.6M8.2 12h7.6" />
  </svg>
);

const SendGlyph = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M3.2 20.4 21 12 3.2 3.6l.1 6.5L15 12 3.3 13.9z" />
  </svg>
);

const dotsGlyph = (
  <span className="dots-glyph">
    <i />
    <i />
    <i />
  </span>
);

const volumeGlyph = (
  <span className="volume-glyph">
    <i style={{ height: '38%' }} />
    <i style={{ height: '78%' }} />
    <i style={{ height: '100%' }} />
  </span>
);

const waveGlyph = (active: boolean) => (
  <span className={`wave-glyph${active ? ' active' : ''}`} aria-hidden="true">
    {[36, 68, 100, 54, 82, 44, 24].map((height, index) => (
      <i key={index} style={{ height: `${height}%` }} />
    ))}
  </span>
);

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => isSpeechSupported() && isVoiceEnabled());
  const [transcribing, setTranscribing] = useState(false);
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);
  const [pendingAutomation, setPendingAutomation] = useState<AutomationTask | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [query, setQuery] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const streamedRef = useRef('');
  const listeningRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechFailedRef = useRef(false);
  const speechNoticeShownRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<PcmCapture | null>(null);
  const voiceOnRef = useRef(voiceOn);

  const loadConversations = async () => {
    try {
      const data = await getConversations();
      setConversations(data.conversations);
    } catch (error) {
      console.error(error);
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const data = await getConversation(id);
      setMessages(data.conversation.messages ?? []);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load conversation.');
    }
  };

  const loadAIStatus = async () => {
    try {
      const data = await getAIStatus();
      setAiOnline(data.status.connected);
    } catch (error) {
      console.error(error);
      setAiOnline(false);
    }
  };

  const loadPendingAutomationTask = async () => {
    try {
      const data = await getPendingAutomation();
      setPendingAutomation(data.tasks[0] ?? null);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    loadConversations().finally(() => setLoading(false));
    void loadAIStatus();
    void loadPendingAutomationTask();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const cleanupMic = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    captureRef.current?.cancel();
    captureRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignoring
    }
    recognitionRef.current = null;
    setVoiceLevel(0);
  };

  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      cleanupMic();
      stopUltronSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
const measureLevel = () => {
    const analyser = analyserRef.current;
    if (!analyser) {
      return;
    }
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    let sumOfSquares = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = (data[i] - 128) / 128;
      sumOfSquares += value * value;
    }
    const rms = Math.sqrt(sumOfSquares / data.length);

    setVoiceLevel(Math.min(1, rms * 4));
    rafRef.current = requestAnimationFrame(measureLevel);
  };

  /** Speak a reply in Ultron's voice (if the voice is enabled). */
  const speak = (text: string) => {
    if (!voiceOnRef.current || !text.trim()) return;
    speakUltron(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
    voiceOnRef.current = next;
    if (!next) {
      stopUltronSpeech();
      setSpeaking(false);
    }
  };

  /**
   * Offline path (desktop app): encode the captured utterance, let Windows'
   * built-in recogniser transcribe it locally, then send it straight through —
   * hands-free conversation, mirroring what typing + Enter would do.
   */
  const handleOfflineTranscription = async (
    chunks: Float32Array[],
    speechHeard: boolean,
    sampleRate: number,
  ) => {
    if (!speechHeard || chunks.length === 0) {
      if (!speechNoticeShownRef.current) {
        speechNoticeShownRef.current = true;
        toast('TerminalTron-T001 heard nothing — try speaking a little louder.', { icon: '🎙️' });
      }
      return;
    }
    setTranscribing(true);
    try {
      const wav = encodeWav16k(chunks, sampleRate);
      const { text } = await transcribeAudio(bytesToBase64(wav));
      const transcript = text.trim();
      if (!transcript) {
        toast("TerminalTron-T001 couldn't make out any words — try again.", { icon: '🎙️' });
        return;
      }
      if (streaming) {
        // Mid-answer: leave it in the composer instead of piling on.
        setPrompt(transcript);
        return;
      }
      await sendPrompt(transcript);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Voice transcription failed.');
    } finally {
      setTranscribing(false);
    }
  };

  const startListening = async () => {
    if (listening || streaming || transcribing) {
      return;
    }
    // Turn-taking: Ultron shuts up when the creator starts talking.
    stopUltronSpeech();
    setSpeaking(false);

    let mic: MediaStream | null = null;
    try {
      // Explicit audio processing: noise suppression + AGC feed the offline
      // recogniser much cleaner speech than a raw mic stream.
      mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (error) {
      toast.error('Microphone unavailable — the orb will still react to typing and replies.');
      return;
    }
    micStreamRef.current = mic;

    try {
      const ctx = new AudioContext();
      await ctx.resume();
      const source = ctx.createMediaStreamSource(mic);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceNodeRef.current = source;
      measureLevel();
    } catch (error) {
      console.error(error);
    }

    const SpeechRecognition = isElectronRuntime() ? null : getSpeechRecognition();
    if (SpeechRecognition) {
      speechFailedRef.current = false;
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          transcript += event.results[i][0].transcript;
        }
        setPrompt(transcript.trim());
      };
      rec.onerror = (event) => {
        if (event.error === 'not-allowed') {
          speechFailedRef.current = true;
          toast.error('Microphone permission denied — enable it in system settings and try again.');
        } else if (
          event.error &&
          event.error !== 'no-speech' &&
          event.error !== 'aborted'
        ) {
          speechFailedRef.current = true;
          if (!speechNoticeShownRef.current) {
            speechNoticeShownRef.current = true;
            toast('Voice-to-text hiccup — the orb still reacts to your voice.', { icon: '🎙️' });
          }
        }
      };
      rec.onend = () => {
        if (listeningRef.current && !speechFailedRef.current) {
          try {
            rec.start();
          } catch {
            // ignoring
          }
        }
      };
      recognitionRef.current = rec;
      try {
        rec.start();
      } catch (error) {
        speechFailedRef.current = true;
        if (!speechNoticeShownRef.current) {
          speechNoticeShownRef.current = true;
          toast('Voice-to-text unavailable here — the orb still reacts to your voice.', {
            icon: '🎙️',
          });
        }
      }
    } else {
      // Electron / no Web Speech: record locally and auto-stop on silence;
      // the utterance is then transcribed offline by the backend.
      const ctx = audioCtxRef.current;
      const source = sourceNodeRef.current;
      if (ctx && source) {
        const sampleRate = ctx.sampleRate;
        captureRef.current = startPcmCapture(ctx, source, {
          onComplete: (chunks, speechHeard) => {
            captureRef.current = null;
            listeningRef.current = false;
            setListening(false);
            cleanupMic();
            void handleOfflineTranscription(chunks, speechHeard, sampleRate);
          },
        });
      } else if (!speechNoticeShownRef.current) {
        speechNoticeShownRef.current = true;
        toast('Voice capture is unavailable here, but the orb reacts to your voice.', {
          icon: '🎙️',
        });
      }
    }

    listeningRef.current = true;
    setListening(true);
  };

  const stopListening = () => {
    listeningRef.current = false;
    setListening(false);
    if (captureRef.current) {
      // Finish the utterance and transcribe what was said, don't discard it.
      const capture = captureRef.current;
      captureRef.current = null;
      capture.stop();
      return;
    }
    cleanupMic();
  };

  const toggleMic = () => {
    if (listening) {
      stopListening();
    } else {
      void startListening();
    }
  };

  const openConversation = async (id: string) => {
    if (streaming) return;
    setActiveId(id);
    setStreamingText('');
    await loadConversation(id);
  };

  const startNewConversation = () => {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
    setStreamingText('');
  };

  const sendPrompt = async (value: string) => {
    if (!value || streaming) return;

    if (listening) {
      stopListening();
    }
    // The creator is commanding: Ultron stops talking and listens.
    stopUltronSpeech();
    setSpeaking(false);

    // If Ultron is waiting on a pending action, a short affirmation or denial
    // answers that prompt — don't forward it to the language model.
    if (pendingAutomation && !automationBusy) {
      const isApproval = APPROVAL_REPLY.test(value);
      const isDenial = DENIAL_REPLY.test(value);
      if (isApproval || isDenial) {
        setPrompt('');
        setMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}-user`,
            conversationId: activeId ?? '',
            role: 'user',
            content: value,
            timestamp: new Date().toISOString(),
          },
        ]);
        if (isApproval) {
          await handleApproveAutomation();
        } else {
          await handleDenyAutomation();
        }
        return;
      }
    }

    const optimisticUser: ConversationMessage = {
      id: `local-${Date.now()}-user`,
      conversationId: activeId ?? '',
      role: 'user',
      content: value,
      timestamp: new Date().toISOString(),
    };

    setPrompt('');
    setMessages((prev) => [...prev, optimisticUser]);
    setStreaming(true);
    setStreamingText('');
    streamedRef.current = '';

    let targetConversationId = activeId;
    let automationMessage = '';
    // Speak sentence-by-sentence as the reply streams, so audio starts within
    // seconds instead of after the whole reply is generated + synthesized.
    if (voiceOnRef.current) {
      startStreamingSpeech({
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
      });
    }

    try {
      await streamPrompt(value, activeId ?? undefined, {
        onStart: (conversationId) => {
          targetConversationId = conversationId;
          setActiveId(conversationId);
        },
        onChunk: (text) => {
          streamedRef.current += text;
          setStreamingText(streamedRef.current);
          if (voiceOnRef.current) {
            pushSpeechChunk(text);
          }
        },
        onAutomation: (payload) => {
          setPendingAutomation(payload.task);
          automationMessage = payload.message;
        },
        onError: (message) => toast.error(message || 'Streaming failed.'),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to reach the AI backend.');
    } finally {
      setStreaming(false);
      setStreamingText('');
      await loadConversations();
      void loadAIStatus();
      if (targetConversationId) {
        await loadConversation(targetConversationId);
      }
      // Ultron already spoke the streamed reply sentence-by-sentence. If nothing
      // streamed (e.g. an automation approval prompt), speak that message now.
      if (voiceOnRef.current) {
        if (streamedRef.current.trim()) {
          endStreamingSpeech();
        } else if (automationMessage) {
          speakUltron(automationMessage, {
            onStart: () => setSpeaking(true),
            onEnd: () => setSpeaking(false),
          });
        } else {
          endStreamingSpeech();
        }
      }
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendPrompt(prompt.trim());
  };

  const handleApproveAutomation = async () => {
    if (!pendingAutomation || automationBusy) return;
    setAutomationBusy(true);
    try {
      const { task } = await approveAutomationTask(pendingAutomation.id);
      const text =
        task.status === 'completed'
          ? task.result ?? 'Action completed.'
          : task.error ?? 'Automation failed.';
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-assistant`,
          conversationId: activeId ?? '',
          role: 'assistant',
          content: text,
          timestamp: new Date().toISOString(),
        },
      ]);
      if (task.status === 'completed') {
        toast.success(text);
      } else {
        toast.error(text);
      }
      setPendingAutomation(null);
      speak(text); // Ultron reports the result out loud
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run automation.');
    } finally {
      setAutomationBusy(false);
    }
  };

  const handleDenyAutomation = async () => {
    if (!pendingAutomation || automationBusy) return;
    setAutomationBusy(true);
    try {
      await denyAutomationTask(pendingAutomation.id);
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-assistant`,
          conversationId: activeId ?? '',
          role: 'assistant',
          content: 'Cancelled — no action was taken.',
          timestamp: new Date().toISOString(),
        },
      ]);
      toast('Action cancelled.', { icon: '🛑' });
      setPendingAutomation(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel automation.');
    } finally {
      setAutomationBusy(false);
    }
  };

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const orbMode: OrbMode = streaming
    ? 'streaming'
    : speaking
      ? 'speaking'
      : listening
        ? 'listening'
        : prompt.trim()
          ? 'typing'
          : 'idle';

  const voiceHeard = listening && voiceLevel > 0.06;
  const orbLabel = transcribing
    ? 'TerminalTron-T001 is transcribing…'
    : orbMode === 'listening'
      ? voiceHeard
        ? 'TerminalTron-T001 hears you…'
        : ORB_LABELS.listening
      : ORB_LABELS[orbMode];

  const needle = query.trim().toLowerCase();
  const visibleConversations = needle
    ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle))
    : conversations;

  const coreState = aiOnline === null ? 'unknown' : aiOnline ? 'ok' : 'bad';
  const coreLabel =
    aiOnline === null
      ? 'Scanning core'
      : aiOnline
        ? 'TerminalTron-T001 core online'
        : 'TerminalTron-T001 core offline';

  const analyserRows = [
    { label: 'Voice', ok: true },
    { label: 'Vision', ok: aiOnline === true },
    { label: 'Memory', ok: conversations.length > 0 },
    { label: 'Response', ok: aiOnline === true && !streaming },
  ];

  return (
    <div className="page-content chat-page">
      <div className="chat-layout">
        <aside className="conversation-list">
          <header className="panel-head">
            <span className="panel-glyph" aria-hidden="true">
              {ChatGlyph}
            </span>
            <h2>Chat History</h2>
          </header>

          <label className="search-box">
            <span className="search-glyph" aria-hidden="true">
              {SearchGlyph}
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations..."
            />
          </label>

          <div className="conversation-scroll">
            {loading ? (
              <p className="muted">Loading conversations…</p>
            ) : visibleConversations.length === 0 ? (
              <p className="muted">No conversations found.</p>
            ) : (
              visibleConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-item${conversation.id === activeId ? ' active' : ''}`}
                  onClick={() => openConversation(conversation.id)}
                >
                  <span className="conversation-glyph" aria-hidden="true">
                    {BubbleGlyph}
                  </span>
                  <span className="conversation-text">
                    <span className="conversation-title">{conversation.title}</span>
                    <span className="conversation-time">
                      {formatTime(conversation.updatedAt)}
                    </span>
                  </span>
                  <span className="conversation-more" aria-hidden="true">
                    {conversation.id === activeId ? volumeGlyph : dotsGlyph}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="chat-panel">
          <header className="chat-panel-head">
            <span className={`core-chip ${coreState}`}>
              <span className="core-dot" aria-hidden="true" />
              {coreLabel}
            </span>
            <button
              type="button"
              className="gold-button"
              onClick={startNewConversation}
              disabled={streaming}
            >
              {PlusGlyph}
              New conversation
            </button>
          </header>

          <div className={`chat-hero${messages.length > 0 || streaming ? ' compact' : ''}`}>
            <div className={`orb-stack ${orbMode}${voiceHeard ? ' talk' : ''}`}>
              <span className="orb-ring ring-a" />
              <span className="orb-ring ring-b" />
              <span className="orb-wave wave-a" />
              <span className="orb-wave wave-b" />
              <span className="orb-core-wrap">
                <span
                  className="orb-core"
                  style={{ transform: `scale(${1 + voiceLevel * 0.24})` }}
                >
                  <HoloEmblem size={70} animate className="orb-logo" />
                </span>
              </span>
            </div>

            <div className="hero-copy">
              <h2>TerminalTron-T001</h2>
              <p className="hero-sub">Stands by</p>
              <p className="hero-status">
                <span className="core-dot" aria-hidden="true" />
                {orbLabel}
              </p>
            </div>

            <aside className="analyser-panel">
              <header>
                <span>Analysing…</span>
                {waveGlyph(listening || streaming)}
              </header>
              <ul>
                {analyserRows.map((row) => (
                  <li key={row.label} className={row.ok ? 'ok' : 'idle'}>
                    <span>{row.label}</span>
                    <span className="analyser-mark" aria-hidden="true">
                      {row.ok ? '✓' : '–'}
                    </span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>

          <div className="chat-messages">
            {messages.length === 0 && !streamingText && (
              <div className="empty-state">
                <h3>Begin, Creator</h3>
                <p>Speak or type below — TerminalTron-T001 is listening and ready to act.</p>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`message-row ${message.role}`}>
                <div className="message-bubble">
                  <pre>{message.content}</pre>
                  <span className="message-meta">
                    {message.role === 'user' ? 'You' : 'TerminalTron-T001'} · {formatTime(message.timestamp)}
                  </span>
                </div>
              </div>
            ))}

            {streaming && (
              <div className="message-row assistant">
                <div className="message-bubble assistant-streaming">
                  <pre>{streamingText || '…'}</pre>
                  <span className="message-meta">TerminalTron-T001 is speaking…</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {pendingAutomation && (
            <div className="automation-card">
              <div className="automation-card-head">
                <span className="automation-icon" aria-hidden="true">
                  ⚙
                </span>
                <div>
                  <strong>{pendingAutomation.title}</strong>
                  <p className="muted">{pendingAutomation.detail}</p>
                </div>
              </div>
              <p className="automation-note">
                TerminalTron-T001 wants to perform this action on your machine. Approve to proceed.
              </p>
              <div className="automation-card-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleApproveAutomation}
                  disabled={automationBusy}
                >
                  {automationBusy ? 'Running…' : 'Approve & run'}
                </button>
                <button
                  type="button"
                  className="primary-button secondary-button"
                  onClick={handleDenyAutomation}
                  disabled={automationBusy}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <form className="chat-composer" onSubmit={handleSubmit}>
            <span className="composer-glyph" aria-hidden="true">
              {waveGlyph(listening || streaming || speaking)}
            </span>
            <textarea
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Speak to TerminalTron-T001…"
              disabled={streaming}
            />
            <button
              type="button"
              className={`mic-button voice-button${voiceOn ? '' : ' muted'}`}
              onClick={toggleVoice}
              disabled={!isSpeechSupported()}
              title={
                !isSpeechSupported()
                  ? 'Voice output is unsupported here'
                  : voiceOn
                    ? "Mute TerminalTron-T001's voice"
                    : "Unmute TerminalTron-T001's voice"
              }
              aria-pressed={voiceOn}
            >
              {SpeakerGlyph(!voiceOn)}
            </button>
            <button
              type="button"
              className={`mic-button${listening ? ' active' : ''}`}
              onClick={toggleMic}
              disabled={streaming || transcribing}
              title={
                transcribing
                  ? 'Transcribing…'
                  : listening
                    ? 'Stop listening'
                    : 'Talk to TerminalTron-T001'
              }
            >
              {listening && <span className="mic-pulse" />}
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
                <path d="M5 11a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 2 0 7 7 0 0 1-6 6.93V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-3.07A7 7 0 0 1 5 11Z" />
              </svg>
            </button>
            <button type="submit" className="send-button" disabled={streaming || !prompt.trim()}>
              {SendGlyph}
              {streaming ? 'Thinking' : 'Send'}
            </button>
          </form>

          <footer className="chat-panel-foot">
            <span>
              {streaming
                ? 'TerminalTron-T001 is transmitting…'
                : speaking
                  ? 'TerminalTron-T001 is speaking…'
                  : transcribing
                    ? 'Transcribing your words…'
                    : listening
                      ? 'Listening…'
                      : 'TerminalTron-T001 stands by'}
            </span>
            <span className="version-tag">TerminalTron-T001 v0.1</span>
          </footer>
        </section>
      </div>
    </div>
  );
}