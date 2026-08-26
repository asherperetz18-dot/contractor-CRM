// Shared between the analyzer action and the settings page. Lives
// outside the "use server" files because those may only export async
// functions, and the settings form wants these as placeholders.

export type SignalHit = { signal: string; evidence: string };

export type LeadAnalysis = {
  temperature: "Hot" | "Warm" | "Cold";
  summary: string;
  positive_signals: SignalHit[];
  negative_signals: SignalHit[];
  next_step: string | null;
  source_counts: { texts: number; calls: number; notes: number; appointments: number } | null;
  analyzed_at: string;
};

// The built-in signal lists, used whenever the company hasn't written
// its own. Contractor-sales specific on purpose.
export const DEFAULT_POSITIVE_SIGNALS = `Asked about financing or payment options
Asked about start dates, timeline, or scheduling
Asked about materials, brands, or specific work details
Asked for license, insurance, or references
Confirmed an appointment or showed up to one
Replied quickly or kept the conversation going
Mentioned a budget in range of the project
Brought a spouse, partner, or co-owner into the conversation
Mentioned permits, HOA approval, or plans already in hand`;

export const DEFAULT_NEGATIVE_SIGNALS = `Said the price is too high or asked for a big discount
Said they hired or are talking to another contractor
Stopped replying after several outreach attempts
Asked to stop texting or calling
Cancelled or no-showed an appointment
Rescheduled more than once
Said they are "just getting quotes" or comparison shopping
The decision maker is never the one in the conversation
Asked for a refund or to cancel the project`;
