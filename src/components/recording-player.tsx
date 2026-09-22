"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { SKIP_SECONDS, clampSeek, formatClock, nextSpeed } from "@/lib/recording-controls";

/**
 * Lands the audio at `target`. Before anything is loaded (preload=none)
 * the spot is remembered and playback started, which fetches the
 * metadata the seek needs; onLoadedMetadata applies it. Clamps against
 * the element's own duration (NaN until then), never React state, so it
 * is safe to call from a listener bound at mount.
 */
function applySeek(audio: HTMLAudioElement, target: number, pending: RefObject<number | null>) {
  const t = clampSeek(target, audio.duration);
  if (audio.readyState === 0) {
    pending.current = t;
    void audio.play().catch(() => {});
  } else {
    audio.currentTime = t;
  }
  return t;
}

/**
 * The call recording player: play/pause, −10s / +10s, a draggable bar,
 * the clock, a speed toggle and a download link.
 *
 * It replaced the browser's own `<audio controls>`, whose one extra was
 * a volume slider: a call is reviewed by jumping to the part that
 * matters, and the native bar sat greyed out because the proxy could not
 * serve a slice (see src/lib/recording-range.ts). Skips are explicit
 * buttons rather than only a drag, so they work with a thumb as well as
 * a mouse.
 *
 * Nothing is fetched until the first press: one row is one live fetch
 * from Twilio or CallRail, and Call Reports renders thousands of rows.
 * `durationHint` (the logged call length) fills the clock and sizes the
 * bar until the file's own metadata arrives.
 */
export function RecordingPlayer({
  src,
  durationHint,
  downloadName,
  autoPlay,
}: {
  src: string;
  durationHint?: number;
  downloadName?: string;
  autoPlay?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLInputElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0); // 0 until metadata arrives
  const [scrub, setScrub] = useState<number | null>(null); // the bar mid-drag
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);

  const total = duration || durationHint || 0;

  function seekTo(target: number) {
    if (audioRef.current) setTime(applySeek(audioRef.current, target, pendingSeek));
  }

  // React's onChange on a range input fires on every pixel of a drag.
  // The native `change` event fires once, on release -- that is the
  // seek; the drag only moves the thumb and the clock.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const commit = () => {
      if (audioRef.current) setTime(applySeek(audioRef.current, Number(bar.value), pendingSeek));
      setScrub(null);
    };
    bar.addEventListener("change", commit);
    return () => bar.removeEventListener("change", commit);
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }

  function cycleSpeed() {
    const next = nextSpeed(speed);
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  if (failed) return <span className="est-tax-note">Recording unavailable</span>;

  const shown = scrub ?? time;
  return (
    <div className="rec-player">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        autoPlay={autoPlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          if (scrub === null) setTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          if (Number.isFinite(audio.duration)) setDuration(audio.duration);
          audio.playbackRate = speed;
          if (pendingSeek.current !== null) {
            audio.currentTime = clampSeek(pendingSeek.current, audio.duration);
            pendingSeek.current = null;
          }
        }}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className="rec-btn"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <button
        type="button"
        className="rec-btn"
        onClick={() => seekTo(time - SKIP_SECONDS)}
        aria-label={`Back ${SKIP_SECONDS} seconds`}
        title={`Back ${SKIP_SECONDS} seconds`}
      >
        −{SKIP_SECONDS}s
      </button>
      <button
        type="button"
        className="rec-btn"
        onClick={() => seekTo(time + SKIP_SECONDS)}
        aria-label={`Forward ${SKIP_SECONDS} seconds`}
        title={`Forward ${SKIP_SECONDS} seconds`}
      >
        +{SKIP_SECONDS}s
      </button>
      <input
        ref={barRef}
        type="range"
        className="rec-bar"
        min={0}
        max={total || 1}
        step={0.1}
        value={Math.min(shown, total || shown)}
        disabled={!total}
        onChange={(e) => setScrub(Number(e.target.value))}
        aria-label="Position in the recording"
      />
      <span className="rec-clock mono">
        {formatClock(shown)} / {total ? formatClock(total) : "–:––"}
      </span>
      <button
        type="button"
        className="rec-btn rec-speed"
        onClick={cycleSpeed}
        aria-label="Playback speed"
        title="Playback speed"
      >
        {speed}×
      </button>
      <a
        className="rec-btn"
        href={src}
        download={downloadName || true}
        aria-label="Download recording"
        title="Download recording"
      >
        ⤓
      </a>
    </div>
  );
}
