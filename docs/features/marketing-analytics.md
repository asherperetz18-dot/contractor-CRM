# Marketing & Analytics

Where leads come from and what they turned into, plus the Facebook Lead Ads and social-profile integrations that feed the pipeline.

| Feature | Status | Description | Code |
|---|---|---|---|
| Marketing analytics | shipped | Per-source lead volume and revenue, date-ranged. Revenue is attributed by signed contract, not pipeline stage — a lead sitting at "Won" with no signed contract behind it does not credit its source with revenue nobody actually committed to. | `src/app/(app)/marketing-analytics/`, `analytics-view.tsx` |
| Rep performance report | shipped | Per-rep report over a date window: appointments held vs. logged-result rate, sellable estimates, revenue — using the *effective* estimate rep (closer if set, else assigned rep) so credit lands on whoever actually sold it. | `src/app/(app)/marketing-analytics/rep-report/` |
| Facebook Lead Ads integration | shipped | Per-company Meta Page connection (page id, access token, verify token, app secret) and a public leadgen webhook that creates leads from Facebook form submissions and fires the new-lead alert. Config is looked up by the company's stored Page id (not a singleton `.single()` row) since a second company previously broke both the webhook verification handshake and silently dropped every lead for every company once more than one existed. | `src/app/(app)/settings/facebook-lead-ads/`, `src/app/api/meta/leadgen/` |
| Social media links | shipped | Company-wide social profile URLs/handles (Facebook, Instagram, LinkedIn, YouTube, etc.) shown on customer-facing surfaces. | `src/app/(app)/settings/social-media/` |
