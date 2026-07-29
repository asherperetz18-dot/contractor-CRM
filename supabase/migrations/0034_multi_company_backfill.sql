-- Multi-company support, step 2 of 4: backfill.
--
-- Creates one `companies` row for the existing business, migrates every
-- profile's roles/can_delete_leads/status into a company_members row for
-- that company, and backfills the new company_id columns from 0033
-- everywhere. Guarded to no-op (with a notice, not an error) if it's
-- accidentally run a second time, since companies is expected to be
-- empty exactly once.
begin;

do $$
declare
  new_company_id uuid;
begin
  if exists (select 1 from companies) then
    raise notice 'companies table already has rows -- skipping backfill (already run?)';
    return;
  end if;

  insert into companies (name)
  select coalesce(name, 'My Company') from company_profile limit 1
  returning id into new_company_id;

  update company_profile set company_id = new_company_id;
  update google_drive_connection set company_id = new_company_id;
  update profiles set company_id = new_company_id;

  insert into company_members (profile_id, company_id, roles, can_delete_leads, status)
  select id, new_company_id, roles, can_delete_leads, status from profiles;

  update leads set company_id = new_company_id where company_id is null;
  update events set company_id = new_company_id where company_id is null;
  update jobs set company_id = new_company_id where company_id is null;
  update documents set company_id = new_company_id where company_id is null;
  update contracts set company_id = new_company_id where company_id is null;
  update lead_tasks set company_id = new_company_id where company_id is null;
  update setter_contacts set company_id = new_company_id where company_id is null;
  update pipeline_stages set company_id = new_company_id where company_id is null;
  update calendars set company_id = new_company_id where company_id is null;
  update project_types set company_id = new_company_id where company_id is null;
  update lead_sources set company_id = new_company_id where company_id is null;
  update call_dispositions set company_id = new_company_id where company_id is null;
  update call_logs set company_id = new_company_id where company_id is null;
  update dial_lists set company_id = new_company_id where company_id is null;
  update role_page_visibility set company_id = new_company_id where company_id is null;
  update sms_quick_texts set company_id = new_company_id where company_id is null;
  update sms_messages set company_id = new_company_id where company_id is null;
  update activity_events set company_id = new_company_id where company_id is null;
  update lead_notes set company_id = new_company_id where company_id is null;
  update lead_files set company_id = new_company_id where company_id is null;
end $$;

commit;
