export type WebhookLeadFields = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone2: string | null;
  phone3: string | null;
  email: string | null;
  address: string | null;
  zip: string | null;
  project_type: string | null;
  notes: string | null;
  value: number;
  source: string;
};

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

/**
 * Maps one flat bag of incoming strings to a lead row, whichever door it
 * came through: the JSON/form POST (website forms, Zapier, the agent
 * review form) or the query-string GET a dialer's web-form button fires.
 * ViciDial's names (`phone_number`, `alt_phone`, `comments`,
 * `address1`/`city`/`state`/`postal_code`) are aliases here, and its
 * blanks arrive as "" — so every fallback treats empty as absent. The
 * postal code goes to the lead's own `zip` column, never into the
 * address string. Returns null when nothing identifies a person; an
 * address or a comment alone is not a lead.
 */
export function webhookLeadFields(
  params: Record<string, string>
): WebhookLeadFields | null {
  const fullName = params.name || params.full_name || "";
  const split = fullName ? splitName(fullName) : { first: "", last: "" };
  const firstName = params.first_name || params.firstName || split.first;
  const lastName = params.last_name || params.lastName || split.last;
  const phone = params.phone || params.phone_number || "";
  const email = params.email || "";

  if (!firstName && !lastName && !phone && !email) return null;

  const composedAddress = [params.address1, params.address2, params.address3, params.city, params.state]
    .filter((p) => p && p.trim())
    .join(", ");
  const address = params.address || composedAddress;

  return {
    first_name: firstName || null,
    last_name: lastName || null,
    phone: phone || null,
    phone2: params.phone2 || params.alt_phone || null,
    phone3: params.phone3 || null,
    email: email || null,
    address: address || null,
    zip: params.zip || params.postal_code || null,
    project_type: params.project_type || params.projectType || null,
    notes: params.message || params.notes || params.comments || null,
    value: Number(params.value) || 0,
    source: params.source || "Website",
  };
}

/** What the person who just saved the lead is told landed — the lead's
 * name when there is one, else the surest handle we have on them. */
export function webhookLeadConfirmation(lead: WebhookLeadFields): string {
  return (
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
    lead.phone ||
    lead.email ||
    "The lead"
  );
}
