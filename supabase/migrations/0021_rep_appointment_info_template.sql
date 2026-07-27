-- Admin-editable template for the "Text Rep Info" button on an appointment
-- (Settings -> Appointment Notifications). Null means use the built-in
-- default.
alter table company_profile add column rep_appointment_info_template text;
