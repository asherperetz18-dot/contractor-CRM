-- Support schema for the Dispatch sub-pages: Marketing Analytics needs a
-- real "when did this lead become Won" timestamp (for date-range filtering
-- and days-to-close), and Appt. Setter Assignments needs a way to record
-- which contacts a setter is assigned to.

alter table leads add column won_at timestamptz;

create function set_won_at() returns trigger as $$
begin
  if new.stage = 'Won' and (TG_OP = 'INSERT' or old.stage is distinct from 'Won') then
    new.won_at = now();
  elsif new.stage is distinct from 'Won' then
    new.won_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger leads_set_won_at before insert or update on leads
  for each row execute function set_won_at();

create table setter_contacts (
  id uuid primary key default gen_random_uuid(),
  setter_id uuid not null references profiles (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (setter_id, lead_id)
);

create index setter_contacts_setter_id_idx on setter_contacts (setter_id);
create index setter_contacts_lead_id_idx on setter_contacts (lead_id);

alter table setter_contacts enable row level security;

create policy "setter_contacts_select" on setter_contacts for select
  to authenticated using (true);
create policy "setter_contacts_write" on setter_contacts for all
  to authenticated using (has_role('Office')) with check (has_role('Office'));
