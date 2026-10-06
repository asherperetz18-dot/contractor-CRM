"use client";

import type { BillChannel } from "@/lib/bill-email";

/**
 * How a bill goes out: by text, by email, or both (DECISIONS #150).
 * Whatever the customer has no number or address for is still offered --
 * the send says so and goes the other way -- but the starting choice is
 * what they can actually receive.
 */
export function defaultBillChannel(contact: { phone?: string | null; email?: string | null }): BillChannel {
  if (contact.phone && contact.email) return "both";
  if (contact.email) return "email";
  return "text";
}

export function sendLabel(channel: BillChannel): string {
  return channel === "both" ? "Send by text & email" : channel === "email" ? "Send by email" : "Send by text";
}

export function SendChannelSelect({
  value,
  onChange,
  disabled,
}: {
  value: BillChannel;
  onChange: (next: BillChannel) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Send by"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as BillChannel)}
    >
      <option value="both">Text and email</option>
      <option value="email">Email</option>
      <option value="text">Text</option>
    </select>
  );
}
