-- Rain-forecast alert feature: scope it to weather-sensitive project types,
-- cache geocoded job-site addresses (keyed by address, not by company --
-- several tables can supply the winning address for one appointment), and
-- track when an appointment has already been warned about so it doesn't
-- fire more than once.

alter table project_types add column weather_sensitive boolean not null default false;

create table address_geocode (
  normalized_address text primary key,
  lat numeric,
  lng numeric,
  nws_office text,
  nws_grid_x int,
  nws_grid_y int,
  resolved_at timestamptz not null default now()
);

-- Service-role only: no client ever reads this cache directly, and it isn't
-- scoped by company_id (an address isn't sensitive on its own), so RLS with
-- no policies blocks anon/authenticated keys entirely while the admin
-- client (used by the weather cron) bypasses RLS as usual.
alter table address_geocode enable row level security;

alter table events
  add column rain_alert_sent_at timestamptz,
  add column rain_alert_pop smallint;
