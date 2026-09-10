-- Missing company_id-leading indexes on the tables that are actually
-- queried and RLS-filtered by company_id directly, not just through an
-- already-indexed parent (lead_id/estimate_id/job_id/bill_id).
--
-- Every RLS policy on a tenant table ANDs in is_member_of_company(company_id)
-- or has_role_in_company(<role>, company_id) (see 0036), so any query
-- against these tables pays a company_id filter whether or not the app's
-- own query mentions one. Without an index, that's a sequential scan of
-- the whole table -- not just this company's rows, every company's, since
-- these are single shared tables across the whole platform. The same bug
-- class already bit this app twice (see docs/DECISIONS.md #002, #003);
-- this migration is closing the gap at the index layer instead of
-- waiting for the next one.
--
-- ── Audit method ─────────────────────────────────────────────────────
-- Every CREATE TABLE (schema.sql + all 146 migrations) was parsed for a
-- company_id column, then cross-checked against every CREATE INDEX,
-- inline UNIQUE, and ALTER TABLE ... ADD CONSTRAINT ... UNIQUE/PRIMARY
-- KEY that already leads with company_id (a unique constraint creates a
-- real index -- counts the same as CREATE INDEX for this purpose, and
-- adding a second one would just be a duplicate). Of the 54 tables that
-- carry a company_id column, 20 already have one: ai_action_proposals,
-- calendars, call_dispositions, call_logs, company_documents,
-- company_phone_numbers, company_profile, contract_templates, estimates,
-- google_drive_connection, job_expenses, lead_ai_analysis, lead_sources,
-- lead_trash, lead_views, pipeline_stages, portal_payments,
-- project_types, property_reports, role_page_visibility, scope_templates,
-- screen_shares, sms_quick_texts, user_devices, vendor_bills, vendors
-- (several of those via a per-company UNIQUE(company_id, name)-style
-- constraint from the 0033 multi-company migration, not a bare index --
-- still real coverage).
--
-- The remaining 34 were checked by hand against their actual RLS policy
-- text and real call sites in src/, not assumed from the column alone:
--
-- Added here (9) -- company_id is the *only* or primary filter in a real
-- "list this company's X" query, and the table can grow past a handful
-- of rows:
--   activity_events, company_members, events, jobs, lead_files,
--   lead_notes, lead_tasks, leads, sms_messages
--
-- Deliberately left out (25):
--   - Estimate line-item children (estimate_files, estimate_groups,
--     estimate_items, estimate_payments, estimate_signers,
--     estimate_views, project_checklist_items) and vendor_bill_payments:
--     every policy on these ANDs in company_id *and* a parent-id check
--     (estimate_visible_to_current_user(estimate_id), etc.), and the app
--     never queries them without that parent id already in the WHERE
--     clause (estimate_id, bill_id -- all already indexed). The parent
--     id is what makes the query selective; a handful of items per
--     estimate/bill doesn't need its own company_id index.
--   - Small per-company config tables already covered by an existing
--     unique(company_id, ...) constraint from 0033/elsewhere: calendars,
--     call_dispositions, lead_sources, pipeline_stages, project_types,
--     role_page_visibility, sms_quick_texts, company_phone_numbers.
--   - checklist_templates, dial_lists, setter_contacts,
--     lead_duplicate_dismissals, signup_invites: same shape (a handful
--     of rows per company -- templates, saved dial lists, dismissed
--     duplicate pairs, pending invites), no unique constraint but also
--     no query or growth pattern that would ever notice a seq scan.
--   - notification_reads, portal_login_tokens, portal_sessions: RLS on
--     these filters by profile_id/lead_id, not company_id -- a
--     company_id index would never get used.
--   - profiles.company_id: dead column, superseded by company_members
--     as of 0033/0036 (see docs/ARCHITECTURE.md). Not indexed because
--     it's not a live query path -- tracked as a candidate for removal
--     in docs/TECH_DEBT.md, not fixed here (out of scope for an index
--     migration).
--   - contracts, documents: legacy tables with effectively no live
--     query path left in src/ (superseded by contract_templates/
--     estimates and lead_files/company_documents respectively) -- see
--     docs/TECH_DEBT.md.
--
-- ── Production safety ────────────────────────────────────────────────
-- Several of the 9 tables below (leads, events, sms_messages,
-- activity_events) take a steady stream of writes in production
-- (webhooks, cron jobs, the activity ping). A plain CREATE INDEX takes a
-- lock that blocks writes for the build's duration; CREATE INDEX
-- CONCURRENTLY does not, at the cost of not being usable inside a
-- transaction block. Following the precedent already set in 0146: run
-- each statement below on its own (no begin/commit) rather than wrapping
-- this file in a transaction.
--
-- If a CONCURRENTLY build is interrupted (connection drop, statement
-- timeout) it can leave behind an INVALID index that silently does
-- nothing. Check with:
--   select indexrelid::regclass, indisvalid from pg_index
--     where indisvalid = false;
-- and if any of these show up invalid, `drop index concurrently
-- <name>;` and rerun that one statement -- don't just re-run the whole
-- file, the others will no-op via IF NOT EXISTS and skip the one that
-- actually needs retrying.

-- ---------------------------------------------------------------- leads
-- 145 call sites query leads; 91 filter by company_id directly (the
-- pipeline board, dashboard counts, search, dedup, etc.) -- the single
-- most central table in the app and the one DECISIONS #002/#003 already
-- describe hitting this bug class on. Paired with created_at desc,
-- matching the existing leads_created_at_idx sort order and the
-- newest-first convention this schema uses everywhere else
-- (estimates_company_status_idx, vendor_bills_company_idx, etc.).
create index concurrently if not exists leads_company_idx
  on leads (company_id, created_at desc);

-- --------------------------------------------------------------- events
-- Powers Schedule/Calendar and all three appointment/rain-alert cron
-- jobs, all of which filter by company_id first. DECISIONS #003 already
-- fixed the *leads* side of this page's cost (join instead of
-- fetch-everything); this is the events table's own missing index.
-- Paired with `date`, matching events_date_idx and the actual query
-- shape (a company's appointments in a date window).
create index concurrently if not exists events_company_idx
  on events (company_id, date);

-- ---------------------------------------------------------------- jobs
-- Schedule, Calendar, Production, and the dashboard home page all run
-- `select("*").eq("company_id", companyId)` against jobs with no other
-- filter -- the exact fetch-the-whole-company shape. Paired with
-- created_at desc as the common default order (Production's own list
-- view); pages that want a different order (Schedule/Calendar sort by
-- name) still benefit from the index narrowing to this company first.
create index concurrently if not exists jobs_company_idx
  on jobs (company_id, created_at desc);

-- --------------------------------------------------------- sms_messages
-- The Reply Inbox is a company-wide, cross-lead view
-- (`.eq("company_id", companyId)` with no lead_id) -- the one query shape
-- the existing lead_id/sent_by indexes don't cover. This table also only
-- grows (every inbound/outbound text is a row).
create index concurrently if not exists sms_messages_company_idx
  on sms_messages (company_id, created_at desc);

-- ------------------------------------------------------------ lead_tasks
-- The task-reminders cron scans a company's due tasks directly
-- (`.eq("company_id", ...)` joined with a due-date window), separately
-- from any single lead's task list. Paired with due_date, matching the
-- existing lead_tasks_due_date_idx and the cron's own filter.
create index concurrently if not exists lead_tasks_company_idx
  on lead_tasks (company_id, due_date);

-- ------------------------------------------------------------ lead_files
-- The Google Drive backup batch job pages through
-- `.eq("company_id", ...).eq("storage_provider", "supabase")` company-wide,
-- independent of any one lead -- lead_files_lead_id_idx doesn't help that
-- query at all.
create index concurrently if not exists lead_files_company_idx
  on lead_files (company_id, created_at desc);

-- ------------------------------------------------------------ lead_notes
-- Smaller share of call sites filter by company_id directly than
-- lead_files, but the table has the same unbounded growth shape (one row
-- per note, forever) and the same "can plausibly exceed 1,000 rows"
-- profile 0002 warns about. Added proactively rather than waiting for a
-- company-wide notes view to make it a live incident.
create index concurrently if not exists lead_notes_company_idx
  on lead_notes (company_id, created_at desc);

-- -------------------------------------------------------- activity_events
-- Backs Settings -> Team Activity, a company-wide read
-- (has_role_in_company('Office'/'Admin', company_id) is the *only* gate
-- on activity_events_select_admin -- no narrower id in that policy at
-- all), and the table is a pure append-only log (one row per ping/action,
-- across every user, forever).
create index concurrently if not exists activity_events_company_idx
  on activity_events (company_id, created_at desc);

-- ----------------------------------------------------------- company_members
-- This is the table every other table's RLS ultimately calls into
-- (is_member_of_company / has_role_in_company both query it), and it's a
-- single shared table across every company on the platform -- unlike the
-- others above, a given company's own slice stays small (headcount), but
-- the *table* grows with total companies on the platform. The existing
-- unique(profile_id, company_id) is profile_id-first, which doesn't help
-- a "list this company's members" query
-- (screen-share.ts, settings/users-roles) that only ever supplies
-- company_id. Paired with status, matching that query's own
-- `.eq("status", "Active")` and the vendors_company_active_idx-style
-- convention elsewhere in this schema.
create index concurrently if not exists company_members_company_idx
  on company_members (company_id, status);
