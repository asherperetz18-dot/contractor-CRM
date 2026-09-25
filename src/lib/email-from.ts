// No `import "server-only"`: pure, so node:test can import it.

export type CompanySenderColumns = {
  email_from: string | null;
  email_from_name: string | null;
  /** company_profile.name */
  name: string | null;
};

/**
 * A display name safe to put in a From header: no header-breaking
 * characters, nothing sendEmail's non-Latin-1 guard would refuse (an emoji
 * or em dash in a company name must never stop its estimates sending), and
 * quoted when it carries RFC 5322 punctuation like "Smith & Sons, Inc.".
 */
function displayName(raw: string | null): string | null {
  const cleaned = [...(raw ?? "")]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 255 && code !== 127 && !'"<>'.includes(ch);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return /[()[\]:;@\\,.]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/**
 * The From header on a company's customer-facing email.
 *
 * With its own address set (Settings → Email) it is that address, as
 * before. Without one it sends from the platform's verified address, but
 * under the company's name -- the platform's own display name is La Home
 * Contractor, and another company's customer must never see it.
 */
export function companyFromHeader(company: CompanySenderColumns, platformFrom: string): string {
  if (company.email_from) {
    return company.email_from_name
      ? `${company.email_from_name} <${company.email_from}>`
      : company.email_from;
  }
  const name = displayName(company.email_from_name) ?? displayName(company.name);
  if (!name) return platformFrom;
  const address = platformFrom.match(/<([^>]+)>\s*$/)?.[1] ?? platformFrom.trim();
  return `${name} <${address}>`;
}
