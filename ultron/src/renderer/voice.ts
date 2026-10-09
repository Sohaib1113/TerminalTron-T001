/**
 * Ultron's voice — text-to-speech tuned for a deep, robotic cadence.
 * Uses the Web Speech API (system SAPI voices; works in Chromium and Electron).
 */

const ENABLED_KEY = 'ultron.voice.enabled';

export const isSpeechSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

export const isVoiceEnabled = (): boolean => {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
};

export const setVoiceEnabled = (on: boolean): void => {
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable — voice simply won't persist */
  }
};

let voices: SpeechSynthesisVoice[] = [];

const refreshVoices = (): SpeechSynthesisVoice[] => {
  if (isSpeechSupported()) {
    const list = window.speechSynthesis.getVoices();
    if (list.length) {
      voices = list;
    }
  }
  return voices;
};

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    refreshVoices();
  });
}

/** Deep male voices first — closest match to Ultron's timbre. */
const PREFERRED_VOICE =
  /(david|mark|male|zira|daniel|alex|george|richard|guy|ryan|christopher|james|fred)/i;

const pickVoice = (): SpeechSynthesisVoice | null => {
  const all = refreshVoices().length ? refreshVoices() : voices;
  if (!all.length) {
    return null;
  }
  const english = all.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const pool = english.length ? english : all;
  return pool.find((v) => PREFERRED_VOICE.test(v.name)) ?? pool[0];
};

/** Strip markdown/URLs so TTS never reads raw markup aloud. */
export const toSpeakableText = (raw: string): string =>
  raw
    .replace(/```[\s\S]*?```/g, ' code snippet. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*|__|~~|\*|_/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Split into TTS-friendly chunks. Chromium stalls utterances after ~15s, so
 * long replies are assembled from sentence-sized pieces.
 */
const chunkForSpeech = (text: string, maxLen = 220): string[] => {
  const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (!current) {
      current = sentence;
    } else if ((current + ' ' + sentence).length <= maxLen) {
      current += ' ' + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
    while (current.length > maxLen) {
      chunks.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
};

let token = 0;
let onEndCurrent: (() => void) | null = null;

const fireEnd = (): void => {
  const end = onEndCurrent;
  onEndCurrent = null;
  end?.();
};

/** Immediately silence Ultron (any in-flight speech is discarded). */
export const stopUltronSpeech = (): void => {
  token += 1;
  if (isSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
  fireEnd();
};

/**
 * Speak `text` in Ultron's voice. Returns false when there was nothing to say
 * or speech is unsupported. Only one utterance is active at a time — a new
 * call (or `stopUltronSpeech`) supersedes the previous one, firing its onEnd.
 */
export const speakUltron = (
  text: string,
  handlers: { onStart?: () => void; onEnd?: () => void } = {},
): boolean => {
  stopUltronSpeech();
  const spoken = toSpeakableText(text);
  if (!spoken || !isSpeechSupported()) {
    return false;
  }
  const myToken = token;
  onEndCurrent = handlers.onEnd ?? null;
  handlers.onStart?.();
  const synth = window.speechSynthesis;
  const voice = pickVoice();
  const chunks = chunkForSpeech(spoken);
  let index = 0;

  const speakNext = (): void => {
    if (myToken !== token) {
      return; // superseded — end already fired
    }
    if (index >= chunks.length) {
      fireEnd();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    index += 1;
    if (voice) {
      utterance.voice = voice;
    }
    utterance.pitch = 0.55; // deep — Ultron
    utterance.rate = 0.92; // measured cadence
    utterance.volume = 1;
    utterance.onend = () => {
      if (myToken === token) {
        speakNext();
      }
    };
    utterance.onerror = () => {
      if (myToken === token) {
        speakNext();
      }
    };
    synth.speak(utterance);
  };

  // Chromium needs a beat after cancel() before accepting new speech.
  setTimeout(speakNext, 60);
  return true;
};
