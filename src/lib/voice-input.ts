/**
 * Voice input/output helpers for the AI assistant chat.
 *
 * Recognition and speech both come from the browser's own Web Speech
 * API — no transcription service, no key, no audio leaving the device
 * beyond what the browser itself does. The trade, logged in TECH_DEBT:
 * support and accuracy are the browser's (Chrome and Safari carry it;
 * a browser without it simply never shows the mic), and the typed
 * input stays the path that always works.
 */

export type SpeechResultLike = { isFinal: boolean; transcript: string };

/**
 * One utterance out of however many progressive segments the browser
 * reported. Final only when every segment is final — that is the moment
 * the question auto-sends, so an interim guess must never qualify.
 */
export function mergeTranscript(results: SpeechResultLike[]): { text: string; isFinal: boolean } {
  const text = results
    .map((r) => r.transcript.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  return { text, isFinal: results.length > 0 && results.every((r) => r.isFinal) };
}

/**
 * What a recognition failure says in the chat. Silence and a self-tap
 * of stop are choices, not failures, so they say nothing; a blocked
 * mic names its fix; everything else gets one generic line — a raw
 * error code on screen reads as the app being broken.
 */
export function micErrorMessage(code: string | undefined): string | null {
  if (code === "no-speech" || code === "aborted") return null;
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone access is blocked — allow it in your browser settings to talk to the assistant.";
  }
  return "Voice input didn't work — type your question instead.";
}

/**
 * A reply reshaped for the speaker instead of the screen: bullet dashes
 * drop (a read-aloud "dash Bob Smith" is noise), every line lands on
 * terminal punctuation so the voice pauses like a sentence, and blank
 * lines collapse instead of reading as dead air.
 */
export function speakableReply(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^-\s+/, ""))
    .filter(Boolean)
    .map((line) => (/[.!?:]$/.test(line) ? line : `${line}.`))
    .join(" ");
}

// ── Browser glue (typed here because TS's dom lib has SpeechSynthesis
// but not SpeechRecognition) ─────────────────────────────────────────

export type SpeechRecognitionResultsLike = ArrayLike<
  { isFinal: boolean } & ArrayLike<{ transcript: string }>
>;

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: SpeechRecognitionResultsLike }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

/** SpeechRecognitionResultList is index-plus-length with the best
 *  alternative at [0]; this flattens it to plain data for merging. */
export function resultsToSegments(results: SpeechRecognitionResultsLike): SpeechResultLike[] {
  const segments: SpeechResultLike[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    segments.push({ isFinal: result.isFinal, transcript: result[0]?.transcript ?? "" });
  }
  return segments;
}

/** Null on the server and on browsers without the API — the mic button
 *  simply doesn't render, and typing stays the whole story. */
export function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
