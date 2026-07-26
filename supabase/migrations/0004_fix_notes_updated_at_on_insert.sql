-- Bug fix: notes_updated_at was only set on UPDATE, so a lead created
-- with notes already filled in (e.g. via the webhook) immediately showed
-- as "Stale Notes" in the Pipeline digest. Set it on INSERT too.

create or replace function set_notes_updated_at() returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    if new.notes is not null then
      new.notes_updated_at = now();
    end if;
  elsif new.notes is distinct from old.notes then
    new.notes_updated_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger leads_set_notes_updated_at on leads;
create trigger leads_set_notes_updated_at before insert or update on leads
  for each row execute function set_notes_updated_at();
