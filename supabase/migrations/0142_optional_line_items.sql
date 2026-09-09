-- Optional line items: a priced add-on the customer decides on.
--
-- The ask: "need option of optional item for client to choose — if she
-- needs it she clicks on it to add it". The rep marks a line Optional
-- in the builder; the customer's document shows it priced with a tick
-- box, and only once they tick it does it join the subtotal, the tax
-- and the deposit-bearing total.
--
-- Two columns rather than one, because they answer different questions
-- owned by different people. is_optional is the office's offer ("this
-- line is yours to take or leave") and is written by the builder.
-- optional_selected is the customer's answer and is written only from
-- the portal. Folding both into one nullable state would let an office
-- save silently overwrite what the customer chose -- or worse, let the
-- office "choose" for them.
--
-- Both default false: every existing line stays an ordinary line, and a
-- new optional line starts un-chosen, which is the only honest default
-- for a question the customer has not been asked yet.

alter table public.estimate_items
  add column if not exists is_optional boolean not null default false;
alter table public.estimate_items
  add column if not exists optional_selected boolean not null default false;

comment on column public.estimate_items.is_optional is
  'Offered as an add-on: priced on the document, counted into the totals only once the customer ticks it in the portal.';
comment on column public.estimate_items.optional_selected is
  'The customer''s current choice on an optional line, written only from the portal. Meaningless while is_optional is false.';

-- ── Proof rather than a success message ─────────────────────────────

-- Both columns exist, boolean, not null, defaulting false.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'estimate_items'
  and column_name in ('is_optional', 'optional_selected')
order by column_name;

-- Nothing became optional retroactively: every existing line reads as
-- an ordinary line after this runs.
select count(*) as lines, count(*) filter (where is_optional) as optional_lines
from public.estimate_items;
