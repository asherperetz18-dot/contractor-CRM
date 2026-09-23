/* eslint-disable @next/next/no-img-element -- static screenshots from /public, same as the tutorials */
import type { Metadata } from "next";
import { loadPlanPrice } from "@/lib/marketing/plan";
import "./home.css";

export const metadata: Metadata = {
  title: "AI Build Pros — the CRM built for contractors",
  description:
    "Leads, estimates with e-signature, scheduling, production, payments and commissions in one place — built with a working contractor, for the office and the job site.",
};

// The page is the same for every visitor; the only live input is the plan
// price, read off Stripe. An hour-old price is fine, and it keeps a public
// page from calling Stripe on every hit.
export const revalidate = 3600;

const FEATURES = [
  {
    icon: "📥",
    title: "Every lead, one pipeline",
    body: "Website, Facebook Lead Ads, call tracking and CSV imports land on one board. Drag leads through your own stages and see what's gone cold.",
  },
  {
    icon: "📞",
    title: "Call and text from the CRM",
    body: "A dial queue, click-to-call, two-way texting and a reply inbox, all logged on the customer's card. Appointment reminders go out by text on their own.",
  },
  {
    icon: "📝",
    title: "Estimates they sign online",
    body: "Build estimates from your scope library, send them by email, and get them signed on any phone. A signed estimate becomes the contract, with its payment schedule.",
  },
  {
    icon: "💳",
    title: "Get paid on time",
    body: "Customers see their contract, documents and what's due in their own portal and pay by card into your Stripe account. Overdue phases show up before you have to chase them.",
  },
  {
    icon: "🏗️",
    title: "Run production",
    body: "Sold jobs move onto a production board with checklists, crew photos, receipts and permits. Rain alerts warn you before a scheduled day gets washed out.",
  },
  {
    icon: "📊",
    title: "Know your numbers",
    body: "Collected versus spent on every job, profit and loss, bills to pay, and marketing spend by lead source, so you know which ads actually sell work.",
  },
  {
    icon: "💰",
    title: "Commissions without the spreadsheet",
    body: "Sales-rep and dispatcher commissions are worked out from signed and paid jobs, with each rep's advances and payouts recorded against what they've earned.",
  },
  {
    icon: "⏱️",
    title: "Time clock and team map",
    body: "Crews clock in from their phones. See who's on the clock and where, with arrivals at a job logged on their own, then export timesheets.",
  },
  {
    icon: "✨",
    title: "AI that saves office time",
    body: "An AI receptionist answers missed calls and books appointments, call notes write themselves, and an assistant answers questions about your own jobs.",
  },
];

const SHOTS = [
  {
    src: "/tutorials/pipeline.png",
    title: "See the whole pipeline at a glance",
    body: "Pipeline value, average deal size, follow-ups due and cold leads sit above the board, so nobody slips through.",
  },
  {
    src: "/tutorials/projects.png",
    title: "Money on every job, as it happens",
    body: "Sold, collected, owed and spent on each project. A job taking in less than it has cost is flagged before it becomes a problem.",
  },
];

const FAQ = [
  {
    q: "Who is it for?",
    a: "Remodelers, roofers, builders and other trades that sell jobs in the home: an office that books and sells, and crews that build.",
  },
  {
    q: "Can I bring my existing customers?",
    a: "Yes. Import your contacts from a spreadsheet (CSV), and new leads can flow in automatically from your website, Facebook Lead Ads and call tracking.",
  },
  {
    q: "Does it work on phones and tablets?",
    a: "Every page works on a phone or tablet in the browser, so reps and crews use it from the truck and the job site.",
  },
  {
    q: "What else do I need?",
    a: "Calls and texts run on your own Twilio phone number, and card payments go straight into your own Stripe account, so the money never passes through us. Both connect from Settings.",
  },
  {
    q: "Can I cancel?",
    a: "Any time, from Settings → Subscription. Your data stays put, and everything comes back if you renew.",
  },
];

export default async function HomePage() {
  const price = await loadPlanPrice();

  return (
    <div className="mk">
      <header className="mk-nav">
        <a href="/home" className="mk-brand">
          <img src="/aibuildpros-icon.svg" alt="" width={28} height={28} />
          AI Build Pros
        </a>
        <nav className="mk-nav-links">
          <a href="#features" className="mk-nav-link">Features</a>
          <a href="#pricing" className="mk-nav-link">Pricing</a>
          <a href="/login" className="mk-btn mk-btn-ghost">Sign in</a>
          <a href="/get-started" className="mk-btn mk-btn-primary">Start now</a>
        </nav>
      </header>

      <section className="mk-hero">
        <div className="mk-hero-copy">
          <p className="mk-eyebrow">The CRM built for contractors</p>
          <h1 className="mk-h1">From first call to final payment, in one place.</h1>
          <p className="mk-lead">
            Leads, estimates with e-signature, scheduling, production, payments and
            commissions, built with a working contractor for the office and the job site.
          </p>
          <div className="mk-cta-row">
            <a href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">Start now</a>
            <a href="#features" className="mk-btn mk-btn-ghost mk-btn-lg">See what&apos;s inside</a>
          </div>
        </div>
        <div className="mk-hero-shot">
          <img
            src="/tutorials/dashboard.png"
            alt="The dashboard: open pipeline value, open leads, jobs in progress and upcoming appointments"
            width={2160}
            height={1350}
          />
        </div>
      </section>

      <section id="features" className="mk-section">
        <h2 className="mk-h2">Everything the business runs on</h2>
        <p className="mk-section-sub">
          One system instead of a CRM, a spreadsheet, a calendar and a stack of paper contracts.
        </p>
        <div className="mk-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="mk-feature">
              <span className="mk-feature-icon" aria-hidden="true">{f.icon}</span>
              <h3 className="mk-h3">{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {SHOTS.map((s, i) => (
        <section key={s.src} className={`mk-section mk-shot-row${i % 2 ? " mk-shot-row-flip" : ""}`}>
          <div className="mk-shot-copy">
            <h2 className="mk-h2">{s.title}</h2>
            <p className="mk-section-sub">{s.body}</p>
          </div>
          <div className="mk-shot">
            <img src={s.src} alt={s.title} width={2160} height={1350} loading="lazy" />
          </div>
        </section>
      ))}

      <section id="pricing" className="mk-section mk-pricing">
        <h2 className="mk-h2">Simple pricing</h2>
        <p className="mk-section-sub">One plan with every feature.</p>
        <div className="mk-price-card">
          <p className="mk-price-name">AI Build Pros</p>
          {price ? (
            <p className="mk-price">
              <span className="mk-price-amount">{price.amount}</span>
              <span className="mk-price-per">{price.per}</span>
            </p>
          ) : (
            <p className="mk-price-per">Price shown at checkout</p>
          )}
          <ul className="mk-price-list">
            <li>Every feature on this page</li>
            <li>Customer portal with online payments</li>
            <li>Phone and tablet ready</li>
            <li>Cancel any time from Settings</li>
          </ul>
          <a href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg mk-btn-block">Start now</a>
          <p className="mk-price-note">Secure checkout by Stripe. Your setup link arrives by email.</p>
        </div>
      </section>

      <section className="mk-section mk-faq">
        <h2 className="mk-h2">Questions</h2>
        {FAQ.map((f) => (
          <details key={f.q} className="mk-faq-item">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section className="mk-final">
        <h2 className="mk-h2">Ready to run the business from one place?</h2>
        <a href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">Start now</a>
      </section>

      <footer className="mk-footer">
        <span>© 2026 AI Build Pros LLC. All rights reserved.</span>
        <a href="/login">Sign in</a>
      </footer>
    </div>
  );
}
