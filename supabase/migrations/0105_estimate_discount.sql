begin;

-- Document-level discount, shown to the customer as its own named line
-- between subtotal and tax. Stored as intent (type + value) plus a
-- snapshot of what it came to (discount_cents), recomputed on every
-- totals recalculation -- the same pattern as tax_rate_bp/tax_cents.
-- Percent stores basis points in discount_value; amount stores cents.
alter table estimates add column discount_type text;
alter table estimates add column discount_value bigint not null default 0;
alter table estimates add column discount_label text;
alter table estimates add column discount_cents bigint not null default 0;

commit;
