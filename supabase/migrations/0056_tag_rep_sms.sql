begin;

-- Rep-facing texts were written with the same channel as customer ones,
-- so the Reply Inbox grouped them by the rep's phone and listed
-- teammates as if they were clients. Replying in one of those threads
-- sent a customer message straight to a member of staff.
--
-- Anything to or from a number belonging to a team member is not a
-- customer conversation. That includes the handful of customer
-- confirmations that were misdirected to staff by this very bug -- they
-- were never client threads either. Nothing is deleted; the messages
-- stay in the table and in Text Reports, they just stop pretending to be
-- customer conversations.
--
-- Only 'sms' rows are touched: 'portal' and 'email' rows describe how a
-- message was delivered and must keep saying so.
update sms_messages m
set channel = 'rep'
where m.channel = 'sms'
  and exists (
    select 1
    from profiles p
    where p.phone is not null
      and length(regexp_replace(p.phone, '\D', '', 'g')) >= 10
      and right(regexp_replace(p.phone, '\D', '', 'g'), 10) =
          right(
            regexp_replace(
              case when m.direction = 'outbound' then m.to_number else m.from_number end,
              '\D', '', 'g'
            ),
            10
          )
  );

commit;
