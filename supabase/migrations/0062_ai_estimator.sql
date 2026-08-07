begin;

-- AI scope and estimate generator settings, per company.
--
-- Off by default. This feature proposes prices on a document a homeowner
-- signs, so it is opted into deliberately rather than appearing one day
-- because an app updated.
alter table company_profile
  add column if not exists ai_estimator_enabled boolean not null default false,
  add column if not exists ai_estimator_model text not null default 'claude-opus-5',
  -- Free-text house style: trade vocabulary, what to always include or
  -- exclude, how detailed a scope should be.
  add column if not exists ai_estimator_instructions text,
  -- The company's own prices, in whatever form the owner writes them
  -- ("Demo slab $8/sf. Framing labor $85/hr. Dumpster $650 ea").
  --
  -- This is what makes generated pricing defensible: without it the model
  -- would be guessing at market rates, which is not an estimate, it is a
  -- number that happens to look like one. When it is empty the generator
  -- returns quantities with no prices rather than inventing any.
  add column if not exists ai_estimator_rate_card text;

commit;
