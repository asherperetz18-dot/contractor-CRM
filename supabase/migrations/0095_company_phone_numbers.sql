begin;

-- 0095: every phone number a company may call from. The dialer's
-- "Calling from" list, validated server-side so only numbers the
-- company actually owns can ever be a caller ID.
create table if not exists company_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  phone_number text not null,
  label text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, phone_number)
);

alter table company_phone_numbers enable row level security;

-- Every member may read them (the dialer needs the list); only Office
-- and Admin manage them.
create policy "company_phone_numbers_select" on company_phone_numbers for select
  to authenticated using (is_member_of_company(company_id));

create policy "company_phone_numbers_write" on company_phone_numbers for all
  to authenticated
  using (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id))
  with check (has_role_in_company('Office', company_id) or has_role_in_company('Admin', company_id));

-- The number each company already calls from becomes its first entry,
-- as the default, so nothing changes until somebody picks otherwise.
insert into company_phone_numbers (company_id, phone_number, label, is_default)
select company_id, twilio_phone_number, 'Main line', true
from company_profile
where twilio_phone_number is not null
on conflict (company_id, phone_number) do nothing;

commit;
