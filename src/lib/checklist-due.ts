// Relative and with the extension, not "@/...": this module runs under
// node's test runner (via checklist-due.test.ts), which resolves no
// tsconfig path aliases -- same idiom as every *.test.ts import.
import { addDays, isoDateInZone } from "./company-clock.ts";

/**
 * A template step's due date: the signing day on the company's calendar,
 * plus N days. Counting on the server's (UTC) calendar put a contract
 * signed after 5pm Pacific on the next day, and every step a day late.
 */
export function dueFromOffset(baseIso: string, offsetDays: number, zone: string): string {
  return addDays(isoDateInZone(new Date(baseIso), zone), offsetDays);
}
