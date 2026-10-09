/**
 * Ultron's voice — text-to-speech.
 *
 * PRIMARY ENGINE — XTTS-v2 cloned cinematic voice. A vendored Python server
 * (vendor/tts/xtts_server.py) clones a reference clip (vendor/tts/voices/
 * ultron-reference.mp3) into a natural, movie-like voice and streams WAV back
 * over /health/tts/speak. This is what removes the "basic robot" sound.
 *
 * FALLBACK ENGINE — the Web Speech API (system SAPI voices), used only when the
 * cloned runtime is unavailable (e.g. `npm run tts:prepare` hasn't been run).
 * It sounds robotic, but keeps voice output working out of the box.
 */

import { speakCloned } from './api';

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
let clonedAudio: HTMLAudioElement | null = null;

const fireEnd = (): void => {
  const end = onEndCurrent;
  onEndCurrent = null;
  end?.();
};

// ---------------------------------------------------------------------------
// Streaming speech session (sentence-by-sentence cloned voice)
// ---------------------------------------------------------------------------

// The chat reply streams in token-by-token. We split it into sentences as they
// arrive and speak each one via the proven full-WAV cloned path (speakCloned),
// so Ultron starts talking after the first sentence (~13s) instead of after the
// whole reply (~99s on CPU). Same cloned voice, same natural speed.
// ---------------------------------------------------------------------------
let streamActive = false;
let startedFired = false;
let fullStreamText = '';
let streamHandlers: { onStart?: () => void; onEnd?: () => void } = {};

const revoke = (url: string): void => URL.revokeObjectURL(url);

// --- Sentence-by-sentence cloned voice -------------------------------------
// XTTS on CPU is slow (~13s for a short sentence, ~99s for a paragraph). Rather
// than wait for the WHOLE reply to synthesize before playing anything, we split
// it into sentences as they stream in and speak them one at a time using the
// proven full-WAV cloned path (speakCloned). The first sentence is audible in
// ~13s instead of ~99s, and the next sentence is synthesized while the current
// one plays. Same cloned voice, same natural speed — just starts far sooner.
const SENTENCE_BOUNDARY = /[^.!?…]+[.!?…]+/g;

let sentenceQueue: string[] = []; // complete sentences awaiting speech
let sentenceBuf = ''; // trailing partial sentence
let speakingSentence = false;
let prefetched: { text: string; url: string | null } | null = null;
let prefetchInFlight = false;

/** Kick off synthesis for the head of the queue without awaiting it. */
const startPrefetch = (): void => {
  if (prefetchInFlight || prefetched || !sentenceQueue.length) return;
  const text = sentenceQueue[0];
  prefetchInFlight = true;
  void speakCloned(text)
    .then((url) => {
      prefetched = { text, url };
    })
    .catch(() => {
      prefetched = { text, url: null };
    })
    .finally(() => {
      prefetchInFlight = false;
    });
};

/** Take the cloned-WAV object URL for `sentence`, reusing prefetch if ready. */
const takeSentenceUrl = async (sentence: string): Promise<string | null> => {
  if (prefetched && prefetched.text === sentence) {
    const { url } = prefetched;
    prefetched = null;
    return url;
  }
  return speakCloned(sentence);
};

/** Speak queued sentences one at a time via the cloned voice. */
const pumpSentences = async (): Promise<void> => {
  if (speakingSentence) {
    return;
  }
  const sentence = sentenceQueue.shift();
  if (!sentence) {
    if (!streamActive) {
      fireEnd();
    }
    return;
  }
  speakingSentence = true;
  const myToken = token; // guard against a new session superseding this one
  const isFirst = !startedFired;
  if (isFirst) {
    startedFired = true;
  }
  // Start synthesizing the NEXT sentence now, so it's ready when this one ends.
  startPrefetch();
  const url = await takeSentenceUrl(sentence);
  if (myToken !== token) {
    // superseded
    if (url) revoke(url);
    speakingSentence = false;
    return;
  }
  if (url) {
    const audio = new Audio(url);
    clonedAudio = audio;
    if (isFirst) {
      streamHandlers.onStart?.();
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(() => done());
    });
    revoke(url);
    if (clonedAudio === audio) {
      clonedAudio = null;
    }
  } else {
    // Cloned voice unavailable for this sentence — fall back to Web Speech for
    // just this sentence so speech still works.
    await new Promise<void>((resolve) => {
      speakWithWebSpeech(sentence, token, { onEnd: () => resolve() });
    });
  }
  speakingSentence = false;
  void pumpSentences();
};

/** Begin a streaming speech session for an incoming reply. */
export const startStreamingSpeech = (
  handlers: { onStart?: () => void; onEnd?: () => void } = {},
): void => {
  stopUltronSpeech();
  streamHandlers = handlers;
  onEndCurrent = handlers.onEnd ?? null;
  streamActive = true;
  fullStreamText = '';
  sentenceQueue = [];
  sentenceBuf = '';
  speakingSentence = false;
  startedFired = false;
  prefetched = null;
  prefetchInFlight = false;
};

/** Feed a streamed text chunk; complete sentences are queued for speech. */
export const pushSpeechChunk = (chunk: string): void => {
  if (!streamActive || !chunk) return;
  fullStreamText += chunk;
  sentenceBuf += chunk;
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = SENTENCE_BOUNDARY.exec(sentenceBuf)) !== null) {
    consumed = match.index + match[0].length;
    const sentence = toSpeakableText(match[0]);
    if (sentence) {
      sentenceQueue.push(sentence);
    }
  }
  sentenceBuf = sentenceBuf.slice(consumed);
  // Start synthesizing the next sentence right away (overlaps current playback).
  startPrefetch();
  void pumpSentences();
};

/** Signal no more chunks; flush the trailing sentence and finish. */
export const endStreamingSpeech = (): void => {
  if (!streamActive) return;
  const tail = toSpeakableText(sentenceBuf);
  sentenceBuf = '';
  if (tail) {
    sentenceQueue.push(tail);
  }
  streamActive = false; // no more chunks; pump will fire onEnd when drained
  void pumpSentences();
};


/** Immediately silence Ultron (any in-flight speech is discarded). */
export const stopUltronSpeech = (): void => {
  token += 1;
  streamActive = false;
  speakingSentence = false;
  sentenceQueue = [];
  sentenceBuf = '';
  startedFired = false;
  fullStreamText = '';
  prefetched = null;
  prefetchInFlight = false;
  if (isSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
  if (clonedAudio) {
    clonedAudio.pause();
    clonedAudio = null;
  }
  fireEnd();
};

/**
 * Speak `text` in Ultron's cloned cinematic voice. Tries the XTTS-v2 runtime
 * first; on any failure (runtime not installed / busy) it falls back to the Web
 * Speech API so speech still works. Returns false only when there was nothing to
 * say and speech is unsupported. Only one utterance is active at a time — a new
 * call (or `stopUltronSpeech`) supersedes the previous one, firing its onEnd.
 */
export const speakUltron = async (
  text: string,
  handlers: { onStart?: () => void; onEnd?: () => void } = {},
): Promise<boolean> => {
  stopUltronSpeech();
  const spoken = toSpeakableText(text);
  if (!spoken) {
    return false;
  }
  const myToken = token;
  onEndCurrent = handlers.onEnd ?? null;
  handlers.onStart?.();

  // PRIMARY: cloned XTTS-v2 voice.
  const objectUrl = await speakCloned(spoken);
  if (myToken !== token) {
    // Superseded while we were synthesizing — clean up and bail.
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    return true;
  }
  if (objectUrl) {
    const audio = new Audio(objectUrl);
    clonedAudio = audio;
    const finish = () => {
      URL.revokeObjectURL(objectUrl);
      if (clonedAudio === audio) {
        clonedAudio = null;
      }
      if (myToken === token) {
        fireEnd();
      }
    };
    audio.onended = finish;
    audio.onerror = () => {
      // Cloned playback failed mid-flight — fall back to Web Speech.
      URL.revokeObjectURL(objectUrl);
      if (clonedAudio === audio) {
        clonedAudio = null;
      }
      if (myToken === token) {
        speakWithWebSpeech(spoken, myToken, handlers);
      }
    };
    void audio.play().catch(() => {
      // Autoplay blocked or decode failure — fall back to Web Speech.
      if (myToken === token) {
        speakWithWebSpeech(spoken, myToken, handlers);
      }
    });
    return true;
  }

  // FALLBACK: Web Speech API.
  return speakWithWebSpeech(spoken, myToken, handlers);
};

/** Web Speech fallback path (robotic system voice). */
const speakWithWebSpeech = (
  spoken: string,
  myToken: number,
  handlers: { onStart?: () => void; onEnd?: () => void },
): boolean => {
  if (!isSpeechSupported()) {
    fireEnd();
    return false;
  }
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
