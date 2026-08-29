"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Step = {
  img: string;
  caption: string;
  /** What the narrator says -- usually the caption, spoken. */
  say?: string;
};

type Tutorial = {
  id: string;
  title: string;
  kicker: string;
  desc: string;
  steps: Step[];
};

type Category = { name: string; tutorials: Tutorial[] };

const T = (img: string) => `/tutorials/${img}.png`;

/**
 * Every walkthrough in the library. The screens come from a staged demo
 * company (Summit Builders Co) -- fictional names throughout, so this
 * page is safe in front of anyone.
 */
const LIBRARY: Category[] = [
  {
    name: "Getting Started",
    tutorials: [
      {
        id: "get-around",
        title: "Get around the CRM",
        kicker: "Guided tour · 8 screens · 2 min",
        desc: "The whole system in two minutes: where leads live, where the money shows, and what each page is for.",
        steps: [
          { img: T("dashboard"), caption: "The Dashboard is the day before it happens — open tasks, this week's appointments, and call activity." },
          { img: T("pipeline"), caption: "The Leads Pipeline holds every open lead on one board. Drag cards through your stages; the totals update live." },
          { img: T("lead-card"), caption: "Open any lead and the Lead Card holds the whole customer — calls, texts, notes, files, appointments and estimates, in tabs." },
          { img: T("calendar"), caption: "The Calendar shows the week by rep, in the rep's color. REP and CUST badges show who has confirmed." },
          { img: T("estimates"), caption: "Estimates & Contracts lists every document and its status — draft, sent, signed." },
          { img: T("projects"), caption: "Projects is sold work with the money on top: contract, collected, owed, spent and net cash per job." },
          { img: T("call-reports"), caption: "Call Reports keeps every conversation — recordings, durations, outcomes, and which ad made the phone ring." },
          { img: T("marketing"), caption: "Marketing Analytics ties it together: cost per lead and cost per sale, by source, from real numbers." },
        ],
      },
    ],
  },
  {
    name: "Leads & Sales",
    tutorials: [
      {
        id: "create-lead",
        title: "Create a lead",
        kicker: "Quick how-to · 3 steps · 1 min",
        desc: "From phone call to lead card in under a minute.",
        steps: [
          { img: T("pipeline"), caption: "Open Leads Pipeline and tap + New Lead, top right." },
          { img: T("t-new-lead-form"), caption: "Fill in the name, phone and where the lead came from — the source is what makes your marketing numbers true. Save." },
          { img: T("lead-card"), caption: "The lead card opens, ready to work: call or text from the card, add notes, book the first appointment." },
        ],
      },
      {
        id: "book-appointment",
        title: "Book an appointment",
        kicker: "Quick how-to · 3 steps · 1 min",
        desc: "Put a visit on the board and get it confirmed.",
        steps: [
          { img: T("calendar"), caption: "Open the Calendar — the week view shows every rep's day side by side." },
          { img: T("t-event-form"), caption: "Tap + New Appointment. Pick the customer, the rep and the time; the property photo and map help you route the day." },
          { img: T("calendar"), caption: "The visit lands on the board in the rep's color. When the customer confirms by text, the CUST badge turns on." },
        ],
      },
    ],
  },
  {
    name: "Estimates & Money",
    tutorials: [
      {
        id: "estimate-to-contract",
        title: "From estimate to signed contract",
        kicker: "Deep dive · 3 steps · 2 min",
        desc: "Build it, send it, watch it get signed from a phone.",
        steps: [
          { img: T("estimates"), caption: "Estimates & Contracts lists every document. Open one, or start fresh from a lead's card." },
          { img: T("t-estimate-builder"), caption: "The builder holds the scope, line items, photos and discounts. The customer-facing document builds itself as you type." },
          { img: T("t-estimate-payments"), caption: "Set the payment schedule by phases, then send. The customer signs from their phone, and the estimate becomes the contract." },
        ],
      },
      {
        id: "snap-receipt",
        title: "Snap a receipt onto a job",
        kicker: "Quick how-to · 2 steps · 45 sec",
        desc: "At the supply-house counter: job, photo, amount, done.",
        steps: [
          { img: T("projects"), caption: "Open Projects and tap + Receipt. It's built for a phone in one hand and a receipt in the other." },
          { img: T("t-receipt-modal"), caption: "Pick the job, snap or attach the receipt, enter the amount, save. It files against the job's costs — and the form stays open for the next one in the stack." },
        ],
      },
    ],
  },
];

/** A short synthesized voice for each step, using the browser's own narrator. */
function useNarrator() {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const speak = useCallback(
    (text: string, onDone: () => void) => {
      if (!synth) {
        const t = setTimeout(onDone, 7000);
        return () => clearTimeout(t);
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      const v =
        voices.find((x) => /en[-_]US/i.test(x.lang) && /natural|neural|online|aria|google us/i.test(x.name)) ||
        voices.find((x) => /en[-_]US/i.test(x.lang)) ||
        null;
      if (v) u.voice = v;
      u.rate = 1.02;
      let finished = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = () => {
        if (finished) return;
        finished = true;
        timer = setTimeout(onDone, 1800);
      };
      u.onend = finish;
      u.onerror = finish;
      // A muted machine must never read as a frozen player.
      timer = setTimeout(finish, 15000);
      synth.speak(u);
      return () => {
        finished = true;
        clearTimeout(timer);
        synth.cancel();
      };
    },
    [synth]
  );
  const stop = useCallback(() => synth?.cancel(), [synth]);
  return { speak, stop, available: !!synth };
}

function Player({ tutorial, onClose }: { tutorial: Tutorial; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const [auto, setAuto] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const cancelRef = useRef<(() => void) | undefined>(undefined);
  const { speak, stop, available } = useNarrator();
  const step = tutorial.steps[at];

  // One narration per visible step; moving on (or closing) cancels it.
  useEffect(() => {
    cancelRef.current?.();
    if (!auto) return;
    if (voiceOn && available) {
      cancelRef.current = speak(step.say ?? step.caption, () => {
        setAt((n) => {
          if (n + 1 >= tutorial.steps.length) {
            setAuto(false);
            return n;
          }
          return n + 1;
        });
      });
    } else {
      const t = setTimeout(() => {
        setAt((n) => {
          if (n + 1 >= tutorial.steps.length) {
            setAuto(false);
            return n;
          }
          return n + 1;
        });
      }, 7000);
      cancelRef.current = () => clearTimeout(t);
    }
    return () => cancelRef.current?.();
  }, [at, auto, voiceOn, available, speak, step, tutorial.steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") { setAuto(false); setAt((n) => Math.min(n + 1, tutorial.steps.length - 1)); }
      if (e.key === "ArrowLeft") { setAuto(false); setAt((n) => Math.max(n - 1, 0)); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, [onClose, stop, tutorial.steps.length]);

  return (
    <div className="tut-player" role="dialog" aria-label={tutorial.title}>
      <div className="tut-player-head">
        <strong>{tutorial.title}</strong>
        <span className="tut-step-count">
          {at + 1} / {tutorial.steps.length}
        </span>
        <div className="tut-player-tools">
          {available && (
            <button
              className="btn-ghost small"
              onClick={() => {
                setVoiceOn((v) => {
                  if (v) stop();
                  return !v;
                });
              }}
            >
              {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
            </button>
          )}
          <button
            className="btn-ghost small"
            onClick={() => setAuto((a) => !a)}
          >
            {auto ? "⏸ Pause" : "▶ Resume"}
          </button>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="tut-frame" src={step.img} alt={step.caption} />

      <p className="tut-caption">{step.caption}</p>

      <div className="tut-player-nav">
        <button
          className="btn-ghost"
          disabled={at === 0}
          onClick={() => { setAuto(false); setAt((n) => Math.max(n - 1, 0)); }}
        >
          ← Back
        </button>
        <div className="tut-dots">
          {tutorial.steps.map((_, i) => (
            <button
              key={i}
              className={"tut-dot" + (i === at ? " tut-dot-on" : "")}
              aria-label={`Step ${i + 1}`}
              onClick={() => { setAuto(false); setAt(i); }}
            />
          ))}
        </div>
        {at + 1 < tutorial.steps.length ? (
          <button
            className="btn-primary"
            onClick={() => { setAuto(false); setAt((n) => Math.min(n + 1, tutorial.steps.length - 1)); }}
          >
            Next →
          </button>
        ) : (
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

export function TutorialsView() {
  const [open, setOpen] = useState<Tutorial | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Video Tutorials</h1>
          <p className="page-sub">
            Short, narrated walkthroughs for every part of the CRM. Press play — they talk.
          </p>
        </div>
      </div>

      {LIBRARY.map((cat) => (
        <section key={cat.name} className="tut-cat">
          <h2 className="tut-cat-title">{cat.name}</h2>
          <div className="tut-grid">
            {cat.tutorials.map((t) => (
              <button key={t.id} className="tut-card" onClick={() => setOpen(t)}>
                <span className="tut-play">▶</span>
                <span className="tut-card-body">
                  <span className="tut-kicker">{t.kicker}</span>
                  <span className="tut-title">{t.title}</span>
                  <span className="tut-desc">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="hint-note" style={{ marginTop: 18 }}>
        The screens in these walkthroughs show a demo company with fictional customers.
      </p>

      {open && <Player tutorial={open} onClose={() => setOpen(null)} />}
    </>
  );
}
