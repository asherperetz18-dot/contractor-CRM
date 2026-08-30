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
        id: "notification-bell",
        title: "The notification bell",
        kicker: "Quick how-to · 2 steps · 1 min",
        desc: "One place for everything that needs you: failed texts, overdue invoices, proposal views, overdue steps.",
        steps: [
          { img: T("tut-bell"), caption: "The bell in the topbar counts what's new since you last looked. Open it and the Needs Attention line sums up the day — then every item below links straight to the thing itself: a text that never delivered, an invoice 30 days overdue, a customer who just opened your proposal." },
          { img: T("tut-bell-money"), caption: "The tabs split the feed — Messages, Money, Jobs. The bell computes everything live from your real data, so it can never show a stale count. Mark all read clears the badge; new events light it up again." },
        ],
      },
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
    name: "Teamwork",
    tutorials: [
      {
        id: "screen-share",
        title: "Share your screen with a teammate",
        kicker: "Quick how-to · 3 steps · 1 min",
        desc: "Show your screen and talk it through — office to field, live.",
        steps: [
          { img: T("t-share-pill"), caption: "Tap the 🖥 button in the top bar and pick who should watch — one teammate by name, or anyone on the team. Your browser then asks exactly what to share — whole screen or one window — and a red pill shows you're live." },
          { img: T("tut-share-invite"), caption: "The teammate you picked gets a pop-up that moment — with a chime: Alex wants to share their screen with you. One tap on Join and they're in — and nobody else in the company even sees the session. Pick 'anyone' instead and the whole team gets the old open banner." },
          { img: T("t-share-viewer"), caption: "The viewer sees your screen live and you talk to each other through your microphones, like a phone call with eyes. Either side can mute or leave; Stop ends it for everyone." },
        ],
      },
    ],
  },
  {
    name: "Calls & Texts",
    tutorials: [
      {
        id: "work-the-phones",
        title: "Work the phones",
        kicker: "Quick how-to · 2 steps · 1 min",
        desc: "Recordings, outcomes, and the ad that made it ring.",
        steps: [
          { img: T("call-reports"), caption: "Call Reports keeps every call — duration, recording, outcome, and the marketing source that produced it. Set the disposition right from the row." },
          { img: T("t-lead-calls"), caption: "The same history lives on each lead's Calls tab, so before you dial you can hear how the last conversation went." },
        ],
      },
      {
        id: "reply-inbox",
        title: "Texting & the Reply Inbox",
        kicker: "Quick how-to · 2 steps · 1 min",
        desc: "Every incoming text, answered from one screen.",
        steps: [
          { img: T("t-reply-inbox"), caption: "Every text a customer sends lands in the Reply Inbox as a conversation. Office screens also get a pop-up and a ding the moment one arrives." },
          { img: T("lead-card"), caption: "The same thread lives on the lead's Texts tab — so wherever you are, the whole conversation is one tap away." },
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
  {
    name: "Projects & Production",
    tutorials: [
      {
        id: "job-profitability",
        title: "Read a job's profitability",
        kicker: "Deep dive · 2 steps · 1.5 min",
        desc: "Contract, spent, and what's actually left — phase by phase.",
        steps: [
          { img: T("projects"), caption: "Projects ranks sold jobs worst-first by money: contract, collected, owed, spent, and net cash. A job bleeding cash surfaces on its own." },
          { img: T("t-job-costs"), caption: "Open the contract and the Job costs panel files every receipt against its phase — so you see which part of the job is winning and which is eating the margin." },
        ],
      },
      {
        id: "project-checklists",
        title: "Run the job with checklists",
        kicker: "Quick how-to · 2 steps · 1.5 min",
        desc: "Dated, assigned steps that schedule themselves off the signing day.",
        steps: [
          { img: T("projects"), caption: "Every job row carries a checklist chip. Build templates once — and give each step a 'days after signing' number, so 'file for permit in 3 days' dates itself. Mark one template to apply automatically the moment a contract is signed." },
          { img: T("t-checklist"), caption: "Each step carries a due date and an owner, editable right here. A step past its date and unchecked turns red — so 'did the permit get filed' has an answer, and a deadline." },
        ],
      },
      {
        id: "field-crew",
        title: "Field crew: receipts and photos, no money",
        kicker: "For the crew · 3 steps · 1.5 min",
        desc: "Give crew the Field role and their Projects page becomes a job list with exactly what they need.",
        steps: [
          { img: T("tut-crew-jobs"), caption: "A Field user opens Projects and sees their jobs — address, checklist, and two buttons. No contract amounts, no collections, no totals: the money isn't hidden from this page, it's never sent to it. They check off their own steps as work lands." },
          { img: T("tut-crew-photos"), caption: "Photos opens the job's gallery. Take photo goes straight to the camera; everything lands in the job's file list and its Google Drive Photos folder — the same pictures the office attaches to change orders." },
          { img: T("tut-crew-receipt"), caption: "+ Receipt on a job row opens with that job already picked: snap the receipt at the counter, amount, save. It files against the job's costs, and the form stays open for the next one in the stack." },
        ],
      },
    ],
  },
  {
    name: "Admin & Setup",
    tutorials: [
      {
        id: "team-roles",
        title: "Add your team and control what they see",
        kicker: "Admin · 2 steps · 1.5 min",
        desc: "Sales, dispatch, production, bookkeeping — each sees its job.",
        steps: [
          { img: T("t-users-roles"), caption: "Users & Roles is where people join: create the account, hand out roles, and grant per-person permissions like viewing estimates." },
          { img: T("t-role-visibility"), caption: "Role Visibility decides which pages each role sees. Hide a page from a role and it vanishes from their menu — and stays locked even by direct link." },
        ],
      },
      {
        id: "lead-email-intake",
        title: "Turn lead emails into leads",
        kicker: "Admin · 2 steps · 1 min",
        desc: "Home Depot Pro Referral, Angi, Yelp — forward the email, get the lead.",
        steps: [
          { img: T("t-inbound-email"), caption: "Settings → Lead Email Intake gives your company a private address. Auto-forward your lead-source emails to it — Gmail and Outlook steps are right on the page." },
          { img: T("pipeline"), caption: "Every forwarded email becomes a lead in Unsorted with the true source, and your new-lead text alerts fire. If the sender is already a lead, the email lands on their notes instead." },
        ],
      },
      {
        id: "portal-link",
        title: "Send the customer portal link",
        kicker: "Customer-facing · 2 steps · 1 min",
        desc: "Their estimate, signature, and deposit — from a link you text.",
        steps: [
          { img: T("lead-card"), caption: "Every lead card carries a Customer Portal row — tap Portal Link to text or copy their private link. You'll see when it's been opened." },
          { img: T("t-estimate-payments"), caption: "In the portal the customer reads the estimate, signs from their phone, and pays the deposit online — and every payment lands against the job automatically." },
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
