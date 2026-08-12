/**
 * The recording notice, in one place because both directions must say
 * the same thing.
 *
 * California requires the consent of every party to record a
 * confidential communication (Penal Code 632), and gives the recorded
 * person a civil claim worth $5,000 a call whether or not they can show
 * any harm (637.2). A sales call with a homeowner is the kind of call
 * that qualifies. So this sentence is not decoration around the
 * recording feature -- it is the thing that makes the feature lawful,
 * which is why there is no way to switch it off separately.
 *
 * Present tense on purpose. Every call is recorded, so "may be recorded"
 * would be a hedge about something certain -- and a notice that
 * understates what is happening is a poor foundation for consent.
 *
 * Kept short deliberately: the customer hears this after saying hello
 * and before reaching a person, and every extra second is another
 * chance they decide it is a robocall and hang up.
 */
export const RECORDING_NOTICE = "This call is recorded for quality assurance.";

/**
 * Twilio's <Say> is XML, so anything in the notice has to survive being
 * dropped into an element body.
 */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The <Say> both call paths use, so neither can drift from the other. */
export function recordingNoticeSay(): string {
  return `<Say voice="alice">${xmlEscape(RECORDING_NOTICE)}</Say>`;
}
