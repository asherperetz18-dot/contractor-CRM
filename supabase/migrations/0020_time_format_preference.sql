-- Company-wide preference: display times as 12-hour (standard) or 24-hour
-- (military) throughout the app. Native <input type="time"> pickers are
-- locale-driven and can't be forced to a format by the page, so appointment
-- time fields use a custom picker component that respects this setting.
alter table company_profile add column time_format text not null default '12h';
