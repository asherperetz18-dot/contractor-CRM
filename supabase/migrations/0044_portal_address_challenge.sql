-- Adds a second step to portal sign-in: after opening their magic link the
-- customer must enter their street number. A street number is public
-- information, so this is not a real secret on its own -- its value is that
-- a forwarded email, a leaked link, or someone else reading the customer's
-- texts is no longer enough by itself.
--
-- Because it is guessable (3-5 digits), attempts are counted per token and
-- the token is burned after too many wrong answers.

begin;

alter table portal_login_tokens add column attempts integer not null default 0;

commit;
