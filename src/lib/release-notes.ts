/**
 * What changed in each version of the CRM, in the words a person on the
 * team reads on screen.
 *
 * Every pull request bumps `package.json`'s version AND adds an entry
 * here, newest first (`release-notes.test.ts` fails when the two drift).
 * The entry is what the update popup shows a stale tab ("a new version
 * is out -- here's what's in it") and what the What's new screen shows
 * once, to every browser, after it loads the new build. Write each note
 * as what a user sees differently, not what the code does.
 */

export type ReleaseNote = {
  /** The package.json version this entry describes, e.g. "1.132.0". */
  version: string;
  /** The day it shipped, YYYY-MM-DD. */
  date: string;
  /** One line per change, plain language, newest change first. */
  notes: string[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.263.0",
    date: "2026-10-10",
    notes: [
      "Recording a Showed or Won on an appointment now starts from the contact's current job value, so you only type a number when the job is worth something else.",
    ],
  },
  {
    version: "1.262.0",
    date: "2026-10-10",
    notes: [
      "The Edit Appointment window no longer loses a task or a result. Its Save now saves your changes to the appointment, a result you picked and a task you typed, all in one go (no need to press Add Task first). If one part can't be saved, the window stays open and says which part didn't save and why.",
      "A task you're typing stays put when you switch tabs, and closing the window with Cancel or the X asks before throwing it away. After Save Result the window shows \"✓ Result saved\" and the red dot on Result clears, instead of looking unsaved, and Save Result no longer disappears when someone confirmed the appointment by text after you opened the page.",
      "If Save, Save Result or Delete in that window can't reach the CRM (a dropped signal, for example), it now says so and the button works again, instead of staying greyed out. The same goes for Add Task, ☐ and ✕ in an appointment's or a contact's task list.",
    ],
  },
  {
    version: "1.261.0",
    date: "2026-10-09",
    notes: [
      "In the evening, new things now start on today, not tomorrow: a new task's due date, a new appointment's date (Calendar and the New Appointment window), a new contact's Date received, a recorded payment's Received on and a completion certificate's date. The Signed on paper date no longer lets you pick tomorrow. The Calendar marks today as today after 5pm too, and opens on this month on the last evening of a month.",
      "Today's appointments stay under Upcoming all evening, in a contact's window and on your customer portal. Downloaded backups, company exports and the Lead Refunds CSV are named with today's date.",
    ],
  },
  {
    version: "1.260.0",
    date: "2026-10-09",
    notes: [
      "Settings › Licence & Insurance now goes by your company's clock. On a certificate's last valid day it no longer says it \"has expired and is no longer shown to customers\" after 5pm: it stays valid through that whole day, as your customer portal already showed it.",
    ],
  },
  {
    version: "1.259.0",
    date: "2026-10-09",
    notes: [
      "The Daily Brief opens on its own every morning again. If you closed it after 5pm, it used to count as seen for the next day and skip that morning. It may open once more today, the first time you load the CRM after this update.",
    ],
  },
  {
    version: "1.258.0",
    date: "2026-10-09",
    notes: [
      "QuickBooks, step 3: turn on Settings › QuickBooks › Send invoices to QuickBooks, pick a start date and your QuickBooks product or service for job work. From then on, each bill to a customer goes to your QuickBooks as an invoice (issued invoices, billed stages and each contract's deposit), and each payment as a payment on it, with credits and refunds. Each signed contract becomes a job under its customer, and Bills to Pay costs are tagged to it. Customers keep getting only what the CRM sends them. The Invoices page shows where each bill stands, with Open in QuickBooks; bills with sales tax wait and are entered by hand for now. Anything that can't go says why, and anything it says to enter by hand stays that way, so it's never entered twice.",
    ],
  },
  {
    version: "1.257.0",
    date: "2026-10-09",
    notes: [
      "Booking an appointment from the dial queue in the evening now starts on today, and today can be picked. Before, after 5pm the date started on tomorrow and the calendar wouldn't offer today.",
    ],
  },
  {
    version: "1.256.0",
    date: "2026-10-08",
    notes: [
      "On Projects, a contract signed after 5pm now counts on the day it was signed: a custom Signed range keeps its last evening and no longer takes in the evening before it starts, and \"New this month\" counts your month. A checklist step due today isn't overdue until tomorrow, on the page and its printout alike.",
      "The Start date and Completion date columns on Projects no longer show the day before. A checklist template's \"N days after signing\" now counts from the day the contract was signed, not a day late after an evening signing.",
    ],
  },
  {
    version: "1.255.0",
    date: "2026-10-08",
    notes: [
      "Custom dates now start from today, not tomorrow. On the sales rep report, pressing Custom in the evening opens on this month up to today; before, it could jump a day ahead, or to next month on the last day of the month. On the Dashboard, Dispatch Dashboard, Marketing Analytics and Profit & Loss, typing one custom date in the evening fills the other with today, not tomorrow.",
    ],
  },
  {
    version: "1.254.0",
    date: "2026-10-08",
    notes: [
      "Estimates & Contracts and the Contract Board now go by your company's clock. An estimate or contract made after 5pm counts on the day it was made, so a created-date range keeps its last evening and no longer takes in the evening before it starts. \"Older than 7 days\" counts your days too.",
    ],
  },
  {
    version: "1.253.0",
    date: "2026-10-08",
    notes: [
      "Commission statements now go by your company's clock. A job paid off or signed off after 5pm counts on that day, so on the last day of the month it's payable that month, not the next. The statement opens on your company's month, and every date on it is your day.",
    ],
  },
  {
    version: "1.252.0",
    date: "2026-10-08",
    notes: [
      "Text Reports now goes by your company's clock. A text sent after 5pm counts on the day it was sent, so a date range keeps its last evening and no longer takes in the evening before it starts. The busiest day is your day too.",
      "Profit & Loss: a payment, deposit or billed stage from the evening counts on that day. On the 31st it stays in that month instead of moving to the next, and This month and This year are your company's.",
    ],
  },
  {
    version: "1.251.0",
    date: "2026-10-08",
    notes: [
      "Marketing Analytics and the sales rep report now go by your company's clock. Leads, estimates and contracts from after 5pm count on the day they happened, so a date range you pick keeps its last evening and no longer takes in the evening before it starts. A contract signed on a Sunday evening shows in that week's bar instead of the next week's.",
      "Marketing Analytics: in the evening, today's appointments no longer count as having no result yet on the team table, so it matches the rep report. The page also opens on your last 30 days instead of the server's.",
    ],
  },
  {
    version: "1.250.0",
    date: "2026-10-08",
    notes: [
      "Dispatch Dashboard now goes by your company's clock. Each period starts at your midnight instead of the server's (5pm Pacific): Today no longer counts last night's leads, bookings, calls and texts, and a date range you pick keeps its last evening. A lead that came in yesterday evening shows as a day old under Waiting for a first appointment, not under a day.",
    ],
  },
  {
    version: "1.249.0",
    date: "2026-10-08",
    notes: [
      "Dashboard, Tasks and Payments now go by your company's clock all evening. After 5pm, a task due today no longer counts as overdue, Appointments Today no longer shows tomorrow's, and a customer payment due today isn't marked overdue yet.",
      "Dashboard: calls, sales and payments count on the day they happened on your company's clock. An evening's calls stay on today's bar, and a sale or payment on the evening of the 31st stays in that month.",
    ],
  },
  {
    version: "1.248.0",
    date: "2026-10-08",
    notes: [
      "Tasks: a Done view. Pick Done today, Done this week or Done this month at the top of the Tasks page to see the follow-ups marked done, newest first, with when each was done. The Daily Brief's Tasks Completed number now opens it, on the same period.",
      "Daily Brief: Showed / No-show now opens Appointment Reports on the same days you picked, instead of the last 30 days.",
      "Appointment Reports opens faster: it loads only the period you're looking at instead of every appointment ever, and changing the period loads it in place.",
      "Appointment Reports: in the evening, tomorrow's appointments no longer show up under No Result Yet or in the count of appointments that have already happened.",
      "Daily Brief: tapping a number while the brief is open over that same page now shows the period you tapped. The Schedule and Text Reports no longer snap back to the period that was there, and Call Reports' picker shows Today or This month when that's the number you tapped.",
    ],
  },
  {
    version: "1.247.0",
    date: "2026-10-08",
    notes: [
      "QuickBooks: each bill's receipt now goes with it. The photo or PDF attached to a bill in the CRM is attached to the same bill in QuickBooks, marked as a receipt, so your bookkeeper sees it right on the bill. Bills already in QuickBooks get theirs too. A replaced receipt is replaced there, and Bills to Pay says whether the receipt went (\"In QuickBooks · Bill and receipt\").",
    ],
  },
  {
    version: "1.246.0",
    date: "2026-10-08",
    notes: [
      "Daily Brief: tap a number to see what's behind it. Leads Added opens the Pipeline, Appointments Booked the Schedule, Appointments Scheduled the Schedule on the same days, Showed / No-show the Appointment Reports, Calls and Texts their reports for the same period, and Won the Marketing Analytics. Tasks Completed stays a plain number for now: no page lists finished tasks yet.",
      "Daily Brief: following one of its links now closes it for the day. Before, it opened itself again on top of the page it had just sent you to.",
    ],
  },
  {
    version: "1.245.1",
    date: "2026-10-08",
    notes: [
      "Daily Brief opens faster: it no longer loads every contact, appointment and task your company ever had just to count today, this week and this month. The numbers are the same.",
    ],
  },
  {
    version: "1.245.0",
    date: "2026-10-08",
    notes: [
      "Daily Brief: This Week now starts on Monday and This Month on the 1st, both at midnight on your company's clock. They used to be the last 7 and 30 days, so This Month early in October still counted most of September.",
    ],
  },
  {
    version: "1.244.0",
    date: "2026-10-08",
    notes: [
      "Daily Brief: Today now means since midnight on your company's clock, not the last 24 hours. In the morning it no longer counts most of yesterday, and Appointments Scheduled, Showed and No-show for Today cover today's appointments only. This Week and This Month are unchanged: the last 7 and 30 days.",
    ],
  },
  {
    version: "1.243.2",
    date: "2026-10-08",
    notes: [
      "Daily Brief: Calls, talk time, Texts Out / In and each rep's Calls now count every call and text in the period. Once a company had more than 1,000 calls or texts in total, they were counted from only 1,000 of them and could come out too low.",
    ],
  },
  {
    version: "1.243.1",
    date: "2026-10-08",
    notes: [
      "Daily Brief: Where Leads Came From and Rep Activity now follow the Today / This Week / This Month buttons like the numbers above them. They used to stay stuck on the last 7 days whichever you picked.",
    ],
  },
  {
    version: "1.243.0",
    date: "2026-10-08",
    notes: [
      "QuickBooks, step 2: turn on Settings › QuickBooks › Send bills to QuickBooks and pick a start date. From then on, every bill goes to your QuickBooks a few minutes after it's saved, and every payment on it from the account it was paid from. Changes and voids follow. Bills to Pay shows where each bill stands, with Open in QuickBooks, and anything that can't go says why.",
    ],
  },
  {
    version: "1.242.0",
    date: "2026-10-08",
    notes: [
      "QuickBooks, step 1: Settings › QuickBooks connects your QuickBooks Online (you sign in on Intuit's page) and lets you match your \"paid from\" accounts and cost categories to your QuickBooks accounts. Nothing is sent to QuickBooks yet; bills and payments come next.",
    ],
  },
  {
    version: "1.241.1",
    date: "2026-10-07",
    notes: [
      "The iPhone app can now be built and sent to TestFlight, so the team can install it on iPhones for testing. Nothing changes in the CRM itself.",
    ],
  },
  {
    version: "1.241.0",
    date: "2026-10-07",
    notes: [
      "Several lenders: Settings › Customer Financing lists every lender you offer (Service Finance, Synchrony or another), each with its link, your fee and an On/Off switch, in the order you want them tried. Each estimate picks one (or starts on your first), and the customer sees only that lender's Apply button.",
      "When a lender says no, the estimate's Financing section offers \"Try <next lender> next\": one click moves the estimate to your next lender and texts (or emails) the customer its link.",
    ],
  },
  {
    version: "1.240.1",
    date: "2026-10-07",
    notes: [
      "A job's printed report now takes commission paid out of Net cash, with a \"Commission paid\" line, so it matches the job's row on Projects. The client copy still never shows pay.",
    ],
  },
  {
    version: "1.240.0",
    date: "2026-10-07",
    notes: [
      "Time Clock: \"Your weeks\" shows whether the office approved each of your last few weeks, who approved it and when, and the hours as approved. A reopened week says why. It appears once the office starts approving your weeks on Timesheets.",
    ],
  },
  {
    version: "1.239.0",
    date: "2026-10-07",
    notes: [
      "Offer financing only where it's worth it: each estimate's Financing section has an \"Offer financing to this customer\" switch. Off, they don't see \"Apply for financing\" and there are no link buttons. Settings › Customer Financing sets where new estimates start (on, or off until you turn it on) and your lender's fee, so each estimate shows what financing would cost you.",
      "When a loan pays out, \"Lender kept a fee\" is filled in from your fee and saved as a job cost, so the job's profit is what the loan really brought in.",
    ],
  },
  {
    version: "1.238.0",
    date: "2026-10-07",
    notes: [
      "Customers who finance through their own bank or credit union: in an estimate's Financing section, answer \"Who is financing this job?\" with \"The customer's own lender\" and type its name. Tracking (applied, approved, funded), the pipeline card, the payment change they sign and the payout all use that name, and there's no link to apply since they apply with their own bank. A lender that pays you in draws: record each draw as Funded with its amount.",
    ],
  },
  {
    version: "1.237.0",
    date: "2026-10-07",
    notes: [
      "A contract paying with financing now reads \"Financing\" on Invoices and Money to Collect instead of Overdue: it isn't counted as late, it sits below the late bills, and it isn't offered under Billable Now. No overdue alert rings for it, and the customer's home page says \"Financing\" with your lender instead of an amount due.",
    ],
  },
  {
    version: "1.236.0",
    date: "2026-10-07",
    notes: [
      "Switch a signed contract to financing: when a customer who signed to pay you directly would rather finance the rest, open the contract's Financing panel and choose Switch to financing. They get a one-page payment change to sign on their customer page; the price doesn't change. Once signed, the unpaid payments read \"Financing\" and no bills or reminders go to the customer for them. When the lender pays, record Funded as usual. If the lender says no, \"Back to the original schedule\" puts everything back.",
    ],
  },
  {
    version: "1.235.0",
    date: "2026-10-07",
    notes: [
      "Pipeline cards now show where a customer's financing stands, like \"Financing: Applied · 6d\": amber while you're waiting on the customer or the lender, green when approved or funded, red when declined. The day count makes a stuck application easy to spot. On phones too.",
    ],
  },
  {
    version: "1.234.0",
    date: "2026-10-07",
    notes: [
      "Financing follow-ups: when you text or email a customer the lender's link, or mark them Applied, a follow-up task goes on your Tasks a few days out (3 by default; change it or untick it in the estimate's Financing panel). The next step you record on that estimate closes it.",
    ],
  },
  {
    version: "1.233.1",
    date: "2026-10-07",
    notes: [
      "Recording a funded loan: the \"It pays…\" preview no longer counts an online payment the customer started and never finished, so it matches what gets recorded.",
    ],
  },
  {
    version: "1.233.0",
    date: "2026-10-07",
    notes: [
      "A funded loan can be recorded as the payment it is: in an estimate's Financing panel, pick Funded, enter the amount, and leave \"Also record it as a payment\" ticked. The money goes on the deposit first, then each stage in order, and the job reads paid everywhere.",
      "Financing is now one of the ways to record a payment by hand.",
    ],
  },
  {
    version: "1.232.2",
    date: "2026-10-07",
    notes: [
      "Customer Financing settings now catch a lender link customers can't open, such as Service Finance's application page copied from your own browser (customers got \"Access Denied\"). The page says which link to use instead, and to try it in a private window before saving.",
    ],
  },
  {
    version: "1.232.1",
    date: "2026-10-06",
    notes: [
      "The AI Assistant (✨ in the top bar) answers again. Since yesterday's update every question got \"The AI is temporarily unavailable\" — fixed.",
    ],
  },
  {
    version: "1.232.0",
    date: "2026-10-06",
    notes: [
      "Financing on the estimate: once you've added your lender under Settings › Customer Financing, sent estimates and contracts have a Financing panel. Text or email the customer the link, and record where it stands: Applied, Approved, Declined or Funded.",
      "A customer marked Applied or Approved moves to Pending Finance on the pipeline, unless they're already further along.",
    ],
  },
  {
    version: "1.231.0",
    date: "2026-10-06",
    notes: [
      "Customer financing: if you offer financing through a lender (Wisetack, Hearth, GreenSky or another), paste its application link under Settings › Customer Financing. Your customers then see Apply for financing on their estimates and contracts, until the job is paid for.",
    ],
  },
  {
    version: "1.230.0",
    date: "2026-10-06",
    notes: [
      "Remove a credit: a credit given by hand on an invoice or a contract stage now has a Remove button. Say why, and the bill is owed again. The credit stays listed, crossed out, with who removed it and why, and comes off the customer's statement.",
    ],
  },
  {
    version: "1.229.0",
    date: "2026-10-06",
    notes: [
      "Customer statements can cover a period: pick From and To, or This year, Last year or All time. Everything before it shows as one opening balance, and only what happened in those days is listed.",
      "A statement for a period that has ended shows the balance on its last day and, beside it, what's owed today. Email statement sends the period on screen.",
    ],
  },
  {
    version: "1.228.0",
    date: "2026-10-06",
    notes: [
      "Refund notices: when you record a refund, tick Email the customer that the money is coming back. The email says how much went back, for what and why, and what's still owed. A refund on the Payments page also has an Email refund notice button. That includes Stripe refunds once you've answered \"Still owed?\".",
    ],
  },
  {
    version: "1.227.0",
    date: "2026-10-06",
    notes: [
      "Approve timesheets: once a week is over, open a person on Timesheets and click Approve week, or use Approve all ready. An approved week's hours are locked so nobody can change them after payroll. To change something, click Reopen week and say why.",
      "The payroll export now shows who approved each person's week and when, and the page shows how many of the week's people are approved.",
    ],
  },
  {
    version: "1.226.1",
    date: "2026-10-06",
    notes: [
      "Fix: running the contacts-vs-leads database step again no longer takes the lead cost off a source you un-ticked as a bought list and put the cost back on.",
    ],
  },
  {
    version: "1.226.0",
    date: "2026-10-06",
    notes: [
      "Lead numbers count real leads only. Contacts from a source ticked as a bought list in Settings › Lead Sources, or with no source, no longer count in New leads, the sales funnel, Win rate, Leads by source, the dispatch dashboard, the daily brief or the rep report. The New leads tile shows how many other contacts were added beside it. Sales, revenue and commissions are unchanged.",
      "The bell and pop-ups only announce real leads, so a big list import no longer fills everyone's bell.",
      "Pipeline cards and the Contacts list show a real lead's source in orange as \"Lead · Google\"; a bought list's source is grey. Both pages have a new Leads only filter.",
      "Importing a spreadsheet has a \"These are bought-list contacts, not leads\" box, ticked by default. It ticks the file's sources as bought lists. \"CSV Import\" is now ticked as a bought list.",
      "A contact from a bought list costs $0 as lead cost instead of the $375 default, and contacts already imported from bought lists had the $375 taken off. Enter what a list cost as that month's spend for its source.",
      "Marketing Analytics opens with bought lists excluded. Switch Exclude bought lists off to see what each list produced.",
      "The contact window says under Source whether that contact counts as a lead.",
    ],
  },
  {
    version: "1.225.0",
    date: "2026-10-06",
    notes: [
      "Quick Create has New Contact next to New Lead. New Contact is for anyone, such as a name from a bought list. New Lead asks where the person came from and only offers real lead sources, not the ones ticked as a bought list in Settings › Lead Sources.",
      "Everyone on the Pipeline is now called a contact. The sidebar and the phone's tab say Pipeline, the button says + New Contact, and the import window, the appointment window, the dial queue (its By Lead tab is now By Stage) and the Salespeople page say contact. Lead sources, lead cost, lead refunds and the lead numbers keep the word lead.",
    ],
  },
  {
    version: "1.224.0",
    date: "2026-10-06",
    notes: [
      "Refunds: on the Payments page, use Refund on a payment to record money you gave back by check, cash or transfer, with the reason. The CRM never sends money itself. On a bill it asks whether the customer still owes that amount: No adds a credit so the bill stays paid, and Yes makes the bill owed again (a bounced check, say).",
      "Refunds you make in Stripe now show up by themselves. Answer the \"Still owed?\" question beside them on the Payments page. Until you do, the customer sees the bill as it was before the refund and no payment reminder goes out for it. To turn this on, add the charge.refunded and charge.refund.updated events to your Stripe webhook. Settings › Portal Payments shows if they're missing, and Sync payments from Stripe there picks up refunds from the last 180 days.",
      "Refunds come off Collected and Paid everywhere, and appear on the customer's statement, the invoice page and the job's money list.",
    ],
  },
  {
    version: "1.223.1",
    date: "2026-10-06",
    notes: [
      "A credit now lowers the commission too: the job sold for that much less. Sales and dispatcher commissions are worked out on the contract minus its credits, and a job's commission statement shows the credits under the contract.",
    ],
  },
  {
    version: "1.223.0",
    date: "2026-10-06",
    notes: [
      "Credits: use Give credit on an invoice or a contract's billed payment stage to take something off what the customer owes, for a discount or goodwill, without money changing hands. The bill keeps its amount, the credit comes off what's owed, and the customer sees it with your reason on their statement and in their portal.",
      "Sending a bill again now asks for what's still owed, not the full amount. For example, a $10,000 stage with $6,000 paid asks for $4,000.",
    ],
  },
  {
    version: "1.222.0",
    date: "2026-10-06",
    notes: [
      "Customer statements: click a customer's name on Invoices or Money to Collect, or Statement on an invoice, to see every bill and payment for that customer. Each line shows the running balance, and the top shows what they owe now and how much of it is past due.",
      "Print the statement or save it as a PDF, or use Email statement to send it to the customer. When something is owed, the email includes a View and pay button.",
    ],
  },
  {
    version: "1.221.0",
    date: "2026-10-06",
    notes: [
      "Payment reminders: switch them on under Settings › Payment Reminders and customers are reminded about bills they still owe. A reminder goes 3 days before the due date, on the day, then once a week, up to 3 times. They go by email, text or both, and stop as soon as the bill is paid. Reminders are off until you switch them on.",
      "To stop reminders on one bill (a payment plan, say), use Stop reminders on the invoice or on the contract's payment stage. Those places also show which reminders were sent.",
    ],
  },
  {
    version: "1.220.0",
    date: "2026-10-06",
    notes: [
      "Customers who pay online are now emailed a receipt once the money arrives. It shows the amount, what it paid for and what is still owed. You can switch this off under Settings › Portal Payments.",
      "When you record a check, cash or other payment, tick Email the customer a receipt to send them one. On the Payments page, Email receipt sends one for any payment that has arrived, and Resend receipt sends it again.",
      "Settings › Database Health now also checks the invoicing database updates.",
    ],
  },
  {
    version: "1.219.1",
    date: "2026-10-06",
    notes: [
      "Emailed invoices and payment requests now greet the customer by name. Homeowners were getting \"Hi there\".",
    ],
  },
  {
    version: "1.219.0",
    date: "2026-10-06",
    notes: [
      "Invoices and contract payment requests can now go by email as well as text, or both. Choose how next to the Send button. An emailed invoice comes with a PDF copy attached and a View and pay button, and a second contact on the job is copied in.",
      "The Invoices page now shows Sent for bills that went to the customer, and Billed for ones you only marked as billed. An invoice's page says when it was last sent and how, with Send again.",
      "Every bill you send now appears in the customer's message history, texts as well as emails.",
    ],
  },
  {
    version: "1.218.1",
    date: "2026-10-06",
    notes: [
      "When you send a draft invoice by text and the text can't go out (for example, the customer has no mobile number), the invoice page now says so, so you know to reach them another way. It used to say nothing.",
    ],
  },
  {
    version: "1.218.0",
    date: "2026-10-06",
    notes: [
      "Invoices can be saved as a draft and finished later: set quantities and prices, choose which lines are taxed and at what rate, pick the payment terms (Due on receipt, Net 7, 15 or 30) and add a note for the customer. Send it by text or issue it when it's ready, or delete the draft. Once an invoice is sent it can't be edited; cancel it and send a new one instead.",
      "Invoices now have their own numbers in order (INV-1001, INV-1002 and so on), instead of sharing the estimates' numbers and skipping.",
      "The customer's invoice shows its payment terms, for example \"Terms: Net 15\".",
    ],
  },
  {
    version: "1.217.0",
    date: "2026-10-06",
    notes: [
      "New Invoices page under Accounting: every bill you've sent a customer, invoices and contract stages alike, in one list with where it stands (Billed, Viewed, Part paid, Overdue, Payment clearing, Paid or Void) and what's still owed. Filter by status and by when it was billed, or search by number, customer or project.",
      "Money to Collect now sorts unpaid bills by how late they are (Not due yet, 1–30, 31–90, 90+ days late) instead of how long ago they were sent, and now includes the change-order stages you've billed.",
      "On phones, the money tiles at the top of these pages no longer run off the screen.",
    ],
  },
  {
    version: "1.216.0",
    date: "2026-10-06",
    notes: [
      "The Calendar and Schedule open faster: they no longer download every job the company has ever had, only the jobs their appointments are linked to. The Related Job list in an appointment still has every job; it loads when you open the appointment and shows \"Loading jobs…\" for a moment.",
    ],
  },
  {
    version: "1.215.0",
    date: "2026-10-06",
    notes: [
      "Text Reports opens faster: it loads only the period you pick (last 30 days to start) instead of every text ever sent, and shows 200 texts at a time with a Show more button. The totals at the top still count every text in the period. The period you pick is kept in the page address, so a refresh or a shared link opens on it.",
    ],
  },
  {
    version: "1.214.1",
    date: "2026-10-06",
    notes: [
      "After a customer signs a change order that has its own payment stages, the thank-you message says it's billed in those stages. It used to send them to the contract to pay. A change order without stages still points to the contract.",
    ],
  },
  {
    version: "1.214.0",
    date: "2026-10-06",
    notes: [
      "The Estimates & Contracts list opens faster: it no longer downloads each contract's terms or the signature pictures, which the list never shows. The cards, totals, search and filters work as before.",
    ],
  },
  {
    version: "1.213.0",
    date: "2026-10-06",
    notes: [
      "Customers can pay the rest of a part-paid payment stage online. If a client paid part of a stage by check, their portal now shows what's left with a Pay button for exactly that amount, instead of \"Partially paid\" with no way to pay.",
    ],
  },
  {
    version: "1.212.1",
    date: "2026-10-06",
    notes: [
      "On the Schedule, choosing Custom range before picking a start date now lists the newest appointments first, like Past and All. It was starting from the oldest appointments ever booked.",
    ],
  },
  {
    version: "1.212.0",
    date: "2026-10-06",
    notes: [
      "The Schedule opens faster: it loads only the dates you pick (Upcoming, Today, Past and so on) and the rep you choose, 200 appointments at a time, with Show more at the bottom for the rest. Past and All now list the newest first.",
    ],
  },
  {
    version: "1.211.1",
    date: "2026-10-06",
    notes: [
      "The Calendar's Week view heading now reads properly, like \"Oct 4 – 10, 2026\". It was showing \"Oct 4 – 2026 (day: 10)\".",
    ],
  },
  {
    version: "1.211.0",
    date: "2026-10-06",
    notes: [
      "The Calendar opens faster: it loads the month you're looking at, and the next or previous month loads as you move to it. The line under the title now counts the appointments in view. A link to an appointment, from a contact or a reminder, opens the calendar on that appointment's day.",
    ],
  },
  {
    version: "1.210.0",
    date: "2026-10-06",
    notes: [
      "The Reply Inbox opens faster: it shows your most recent conversations, with Show older conversations at the bottom of the list for anyone further back. A conversation's messages load when you open it, newest first, with Show earlier messages at the top for older ones.",
    ],
  },
  {
    version: "1.209.0",
    date: "2026-10-05",
    notes: [
      "Behind the scenes: appointment and task reminders, no-show follow-ups, rain alerts and the calendar and phone syncs now start from the CRM's own database, on the minute. They used to wait on GitHub, which could run them late when it was busy.",
    ],
  },
  {
    version: "1.208.0",
    date: "2026-10-05",
    notes: [
      "New companies that sign up online now get their first 60 days free instead of 30, still with no card needed. Trials that have already started keep their end date.",
    ],
  },
  {
    version: "1.207.1",
    date: "2026-10-05",
    notes: [
      "The Pay card on a signed change order says the deposit is due now that it's signed, not \"to schedule your project\" — the project is already scheduled.",
      "A cancelled contract or change order no longer lists its cancelled payment stages on the customer's page, matching the PDF copy.",
    ],
  },
  {
    version: "1.207.0",
    date: "2026-10-05",
    notes: [
      "Settings › Role Names lets your company call its team roles what you call them, like Technicians instead of Sales or Front Desk instead of Call Center. The new names show on Users & Roles, Role Visibility, Time Clock settings and Salespeople. What each role can see and do doesn't change. Admin and Office keep their names.",
    ],
  },
  {
    version: "1.206.0",
    date: "2026-10-05",
    notes: [
      "Change orders now show the customer their own payment schedule — the deposit and each stage you set — on the page they sign and on their PDF copy. A change order with no stages says it's billed as one payment on the contract's schedule.",
      "A change order on the customer's page names the contract it adds to again, with the original contract total and the revised total. Customers were seeing neither.",
      "Signed PDF copies show each payment's share as a percent (33.33%), not a long raw number.",
    ],
  },
  {
    version: "1.205.0",
    date: "2026-10-05",
    notes: [
      "New companies get a setup checklist on the Dashboard: business details, logo, texting number, online payments, contract and team, each linking to where it's done. It goes away once everything is set up, and Hide puts it away sooner. Platform admins see each company's progress on the Companies page.",
    ],
  },
  {
    version: "1.204.0",
    date: "2026-10-05",
    notes: [
      "Platform admins can close a company from the Companies page, and reopen it later. A closed company is locked like an ended subscription: its people see a \"closed\" screen and its texts, calls and AI stop. Nothing is deleted.",
    ],
  },
  {
    version: "1.203.0",
    date: "2026-10-05",
    notes: [
      "Backups now include everything a company holds: vendor bills and payments, commission payouts, marketing spend, shared notes, AI receptionist calls and the time clock were missing before.",
      "Platform admins can export any one company's data from the Companies page.",
    ],
  },
  {
    version: "1.202.0",
    date: "2026-10-05",
    notes: [
      "Platform admins can set a monthly limit on a company's AI answers, texts and emails from the Companies page. A company sees its use against any limit in Settings › Subscription, and is told clearly when one runs out; it starts again on the 1st.",
    ],
  },
  {
    version: "1.201.0",
    date: "2026-10-05",
    notes: [
      "Settings › Subscription now shows what your company has used this month: AI answers, texts sent and emails sent.",
    ],
  },
  {
    version: "1.200.0",
    date: "2026-10-05",
    notes: [
      "When a company's subscription ends, its texting, calling, AI tools and automatic reminders pause until it's renewed. Calls and texts from its customers still come in, and nothing is deleted.",
    ],
  },
  {
    version: "1.199.0",
    date: "2026-10-05",
    notes: [
      "Platform admins can give a company on a free trial 7, 14 or 30 more days from the Companies page, which now also shows when each trial ends.",
    ],
  },
  {
    version: "1.198.0",
    date: "2026-10-05",
    notes: [
      "New companies that sign up online get their first 30 days free, with no card needed. A banner counts the days down, and Settings › Subscription has an Add a card button. When a trial ends without a card, the account locks until someone subscribes, and nothing is deleted.",
    ],
  },
  {
    version: "1.197.0",
    date: "2026-10-05",
    notes: [
      "Behind the scenes: the Google Calendar sync's report counts calendars that failed to sync again. Nothing changes on screen.",
    ],
  },
  {
    version: "1.196.0",
    date: "2026-10-05",
    notes: [
      "Every time a platform admin opens a company they aren't a member of, it goes on a record that can't be edited or deleted: who, which company and when. Platform Admin shows it, newest first.",
    ],
  },
  {
    version: "1.195.0",
    date: "2026-10-05",
    notes: [
      "Platform admins have a new Companies page (Admin Tools › Companies): every company with its owner, team size, start date and whether it's paying, on a free trial, locked or not billed, with search and an Open button.",
    ],
  },
  {
    version: "1.194.0",
    date: "2026-10-05",
    notes: [
      "Reminder texts, rain alerts, no-show follow-ups and the calendar and call syncs now run each company separately. If one company's phone, calendar or call-tracking service is down, everyone else's still go out on time.",
    ],
  },
  {
    version: "1.193.0",
    date: "2026-10-05",
    notes: [
      "Your Company Words now reach your team's screens too: the menu, page titles, Quick Create and the Estimates page's cards. A company that says Quote and Job sees \"Quotes & Contracts\", \"Jobs\" and \"New Quote\". If you never changed a word, nothing looks different.",
    ],
  },
  {
    version: "1.192.0",
    date: "2026-10-05",
    notes: [
      "New companies pick their trade when they set up their account — Remodeling, HVAC, Plumbing, Roofing, Solar or Other — and start in its words: an HVAC company's board says \"Service Call Scheduled\", a solar company sends Proposals. Everything can still be changed in Settings.",
    ],
  },
  {
    version: "1.191.0",
    date: "2026-10-05",
    notes: [
      "Settings › Company Words now covers all eight words: appointment and rep joined. Quick texts say your word (\"on my way to your 10am inspection\"), and \"your technician\" when nobody is assigned yet.",
      "The AI receptionist offers your kind of appointment and names it in its confirmation text. The customer portal's appointment cards use your word too.",
      "Quick texts can use {appointment} for your word for it (Settings › Appointment Notifications).",
    ],
  },
  {
    version: "1.190.0",
    date: "2026-10-05",
    notes: [
      "Settings › Company Words now also covers contract, customer and deposit. Your words appear on your documents (on screen and in the PDF) and in the customer portal, not just in what you send.",
      "The customer portal names your company instead of saying \"your contractor\", and its progress steps use one word for your estimates (it said \"Estimate in progress\" and then \"Proposal sent\").",
      "Invoice PDFs now say INVOICE at the top, and completion certificate PDFs say CERTIFICATE OF COMPLETION, like the on-screen copy.",
    ],
  },
  {
    version: "1.189.0",
    date: "2026-10-05",
    notes: [
      "New: Settings › Company Words. Choose the words your customers read — Estimate, Proposal, Quote or Bid; Project, Job, Work Order and more; Change Order, Amendment or Addendum — or type your own.",
      "A sent estimate's text and email now use the same word (they said \"estimate\" and \"proposal\"). Change orders, completion certificates and invoices are now sent as what they are, instead of as \"your estimate\".",
      "The portal sign-in text and email now say \"your portal\".",
    ],
  },
  {
    version: "1.188.0",
    date: "2026-10-05",
    notes: [
      "Every pipeline stage can now be renamed in Settings › Pipeline Stages, including Won, Lost, Unsorted and Appointment Scheduled. Booking, signing, no-show follow-ups and the reports keep working under the new names. A renamed standard stage shows what it works as.",
      "Renaming a stage now also updates the dialer outcomes that move leads into it.",
      "\"Not Interested\" and do-not-contact leads now count as closed everywhere: they no longer add to open pipeline value, open-lead counts, follow-ups due or stale tags.",
    ],
  },
  {
    version: "1.187.0",
    date: "2026-10-05",
    notes: [
      "\"+ New company\" in the company menu is now only for AI Build Pros platform admins. A company made there starts with the standard starter lists, not a copy of the company you were in.",
    ],
  },
  {
    version: "1.186.0",
    date: "2026-10-05",
    notes: [
      "New companies now give their state and time zone when they set up their account, instead of starting on Pacific time.",
      "New companies' commission rates start at zero, ready to set to their own plan, instead of starting with another company's rates. Existing companies keep theirs.",
      "Team Map opens on your company's address when nobody on the clock has a location yet, instead of Los Angeles.",
    ],
  },
  {
    version: "1.185.0",
    date: "2026-10-05",
    notes: [
      "Settings → Contracts: set the deposit your estimates ask for at signing, as a percent of the total with an optional dollar cap. New estimates use it; existing ones keep theirs. Companies licensed in California still can't go above $1,000 or 10%.",
      "The default completion certificate no longer mentions the CSLB or California law, so it fits a company in any state. A certificate you already edited and saved is unchanged.",
    ],
  },
  {
    version: "1.184.1",
    date: "2026-10-05",
    notes: [
      "The examples next to contract fields and settings now use a made-up company (Summit Builders Co) and 555 phone numbers, never another company's or a customer's real details.",
    ],
  },
  {
    version: "1.184.0",
    date: "2026-10-05",
    notes: [
      "Call Center: correcting a contact's details and adding call notes from the Power Dialer now saves, instead of showing a permission error. (Needs the database update in this release.)",
      "AI call notes, the dispatch dashboard's summary, and the record of deleted files now have the database pieces they were missing. (Same database update.)",
      "Settings → Database Health now also checks for these, so a skipped database update is named instead of a feature quietly not working.",
    ],
  },
  {
    version: "1.183.3",
    date: "2026-10-05",
    notes: [
      "Security update: the framework the CRM runs on is updated to its latest patch, closing a published security hole. Nothing looks or works differently.",
    ],
  },
  {
    version: "1.183.2",
    date: "2026-10-05",
    notes: [
      "Settings → Facebook Lead Ads: a saved Page token or app secret is no longer shown on the page. The box says it's saved; leave it blank to keep it, or paste a new one to replace it.",
      "Facebook keys are now stored encrypted, like the Twilio, Stripe and email keys, and only Office or Admin users can change them. Leads keep arriving as before.",
      "If saving the advanced Facebook setup fails, the page now says why instead of showing ✓ Saved.",
    ],
  },
  {
    version: "1.183.1",
    date: "2026-10-05",
    notes: [
      "Fix: the database step that makes texts private now runs. It had stopped with \"contact_phone_key does not exist\".",
      "Fix: a new caller from CallRail or the AI receptionist gets one contact even when two of their calls arrive at once. That guard was built earlier but never switched on.",
    ],
  },
  {
    version: "1.183.0",
    date: "2026-10-05",
    notes: [
      "Dialer: a Text button next to Call. Type or pick a number, tap Text, write the message, and send. If the number belongs to a contact, the text shows on that contact.",
      "Texts are private: Admin, Office, Dispatch and Call Center see every text; everyone else sees only their own conversations. A customer's reply goes to whoever texted them last; if nobody did, to the contact's assigned rep. (Starts once the new database step is run.)",
    ],
  },
  {
    version: "1.182.1",
    date: "2026-10-05",
    notes: [
      "Fix: call recordings made before a company had its own Twilio account play again. They had shown \"No recording\" since the switch to each company's own account.",
    ],
  },
  {
    version: "1.182.0",
    date: "2026-10-05",
    notes: [
      "Android app: a Speaker button during calls, between Mute and Hang Up. Tap it to put the call on the loudspeaker; it turns blue while the speaker is on. Tap again for the earpiece.",
      "The button arrives with the next app build from Google Play. The website doesn't show it, because a browser can't switch the speaker.",
    ],
  },
  {
    version: "1.181.0",
    date: "2026-10-05",
    notes: [
      "Customer emails from a company without its own email setup now go out from AI Build Pros under the company's name, and customers' replies go to the company's email, never to another business's inbox.",
      "Settings → Email: sending from your own address now needs your own Resend account. When you click Connect, the CRM sends you a test email from that address first and saves nothing if it can't send.",
      "Bulk emails and portal links now tell the customer's email app where to send replies.",
    ],
  },
  {
    version: "1.180.0",
    date: "2026-10-04",
    notes: [
      "Phones: the green dial button is back in the top bar, beside the bell, on every screen. Tap it to open the dialer; it no longer hides under More.",
      "Phones: the dialer opens across the screen with big number keys and a full-width Call button that always stays above the bottom tabs. Typing a number opens the number pad.",
      "Android app: calls can now use the microphone. The first call asks once; tap Allow. This needs the new app build from Google Play.",
      "If the microphone is blocked, the dialer now says where to allow it (the phone's Settings in the app, the browser on the website) instead of Twilio's technical message.",
    ],
  },
  {
    version: "1.179.0",
    date: "2026-10-05",
    notes: [
      "Photos, documents, receipts and licence/insurance certificates are now private. A file opens only for someone signed in to that company, or for the customer whose project it belongs to in their portal. Old links that were copied or forwarded stop working once the switch is made.",
      "Nothing changes on screen: thumbnails, previews and downloads work as before.",
    ],
  },
  {
    version: "1.178.0",
    date: "2026-10-02",
    notes: [
      "Texts and calls now always go out from each company's own Twilio number. A company that hasn't connected its own can't text or call until an admin connects it in Settings → Twilio.",
      "A text or call to a number no company has connected is no longer delivered into some company's inbox.",
      "Settings → Twilio: the browser no longer fills your own login email and password into the Twilio boxes.",
    ],
  },
  {
    version: "1.177.3",
    date: "2026-10-04",
    notes: [
      "Settings → Twilio now also checks that the API key for in-app calling was made in the same Twilio account as the number. A key from another account (for example the main account above a sub-account) could save fine and then fail every call.",
      "Fix: when Twilio refuses the dialer's calling setup (error 31100), the dialer now says which setting to fix instead of only showing Twilio's technical message.",
    ],
  },
  {
    version: "1.177.2",
    date: "2026-10-02",
    notes: [
      "Settings → Twilio now checks what you enter with Twilio before saving it: the Account SID and Auth Token, that the number is in that account, and for in-app calling the API Key SID and Secret and the TwiML App. A mistake is explained on the spot instead of being saved and found out on the first call.",
      "Fix: when Twilio refuses a call from the CRM's dialer, the dialer now says why (for example, calling keys that don't match) instead of \"Could not place the call.\", and the next try starts fresh without reloading the page.",
    ],
  },
  {
    version: "1.177.1",
    date: "2026-10-02",
    notes: [
      "Fix: after switching company, a call from the CRM could still ring the customer from the previous company's number. Switching company now reloads the page, so calls, texts and every screen start fresh in the company you switched to.",
    ],
  },
  {
    version: "1.177.0",
    date: "2026-10-02",
    notes: [
      "Settings → Twilio now says plainly when a company has no Twilio account of its own and is sending from a shared number that belongs to another business.",
      "Platform Admin: a new \"Twilio by company\" list shows which number every company texts and calls from, and flags companies that are borrowing the shared number or share one Twilio account.",
    ],
  },
  {
    version: "1.176.0",
    date: "2026-10-02",
    notes: [
      "Security improvements: sending a portal link, attaching files, and connecting Google Drive or Google Calendar now always check the contact or account belongs to the company you're working in.",
      "Customer portal: asking for a sign-in link by email now matches the exact address typed.",
    ],
  },
  {
    version: "1.175.0",
    date: "2026-10-02",
    notes: ["Security improvements to how call recordings are played."],
  },
  {
    version: "1.174.0",
    date: "2026-10-02",
    notes: [
      "Settings → Backup now downloads this company's records only, and its row counts are this company's. Saved passwords and connection keys stay in the CRM and are left out of the file.",
    ],
  },
  {
    version: "1.173.3",
    date: "2026-10-02",
    notes: ["Security improvement: notes, estimates, appointments, texts and files can only be saved under a contact from the same company."],
  },
  {
    version: "1.172.3",
    date: "2026-10-02",
    notes: ["Behind the scenes: the nightly backup is now locked with a password before it is stored."],
  },
  {
    version: "1.172.2",
    date: "2026-10-02",
    notes: [
      "Users & Roles: Office and Admin can change a person's name, phone, email or password only if that person works just in companies they run. Someone who also works for another company changes their own account, and can reset their password with \"Forgot password\" on the sign-in page.",
      "Security improvements to how accounts are protected.",
    ],
  },
  {
    version: "1.172.1",
    date: "2026-10-02",
    notes: ["Behind-the-scenes improvements."],
  },
  {
    version: "1.172.0",
    date: "2026-10-02",
    notes: [
      "Fix: deleting a bill payment's cost from a contract's Job costs panel only removed it from the job. The payment itself stayed in Bills to Pay, so the two pages disagreed and the job's profit read too high. A bill payment is now deleted only in Bills to Pay (✕ on the payment line), which removes it from the job too. Anywhere else, the CRM says where to go instead of deleting half of it.",
      "A contract's Job costs panel no longer adds or deletes bills. It still shows profit by phase and still lets you file each cost to a phase. Add, fix and delete bills on the job in Projects or in Bills to Pay; the panel's new Open in Projects and Bills to Pay buttons take you there.",
      "Filing a bill payment to a phase now moves the whole bill and all its payments to that phase, so one bill is never split across two phases and its next payment lands in the right place.",
    ],
  },
  {
    version: "1.171.2",
    date: "2026-10-01",
    notes: [
      "Fix: if the address lookup service was briefly down, a job's address could be marked \"not on the map\" for good, so its crew showed as off-site and their arrivals weren't logged. A failed lookup now just tries again, and an address marked not found is rechecked the next day, which also fixes any addresses already stuck.",
    ],
  },
  {
    version: "1.171.1",
    date: "2026-10-01",
    notes: [
      "Security fix: when a company's subscription lapses, its client-portal notes and its file deletion history are now locked along with everything else. Nothing changes on screen for anyone with an active subscription.",
    ],
  },
  {
    version: "1.171.0",
    date: "2026-10-01",
    notes: [
      "The Time Clock now checks where you clock in. Clocking in at one of your jobs for the day, or at the office, works the same as before, and the screen confirms it: \"Clocked in at Smith · Roof replacement\".",
      "Clocking in away from every job asks one quick question (\"Picking up materials\", \"Driving to the job\" and so on) and then clocks you in. Nobody is ever stopped from clocking in, and clocking out is never questioned. If your phone can't find your location, you can still clock in.",
      "Timesheets shows off-site clock-ins, clock-ins with no location, and the reason given, with where each clock-in and clock-out happened. The payroll export has an \"Off-site clock-ins\" column.",
      "Crews working a production job are now seen as at the job even on days with no appointment there, on Team Map and in their hours on site.",
      "Settings › Time Clock & Tracking has a new Location check at clock-in setting: off, record only, or ask for a reason (the default), for Field and Production to start.",
    ],
  },
  {
    version: "1.170.1",
    date: "2026-10-01",
    notes: [
      "A screen share invite no longer pops up again every time you refresh. \"Not now\" on an invite is remembered, so it stays closed after a refresh (a new share from the same person still pops up).",
      "When someone who is sharing their screen refreshes or closes their CRM tab, their share now ends right away, so nobody keeps getting an invite to a share that is already gone.",
    ],
  },
  {
    version: "1.170.0",
    date: "2026-09-30",
    notes: [
      "Picking a salesperson on Estimates & Contracts now also shows the jobs where they are the closer or the second salesperson, not only the ones where they are the salesperson. The cards at the top count those jobs too. The Contract Board works the same way.",
      "The Salesperson column now lists the closer and second salesperson under the salesperson's name, for example \"Closer: Simon Benhamo\", so you can see why a job shows up under someone's name.",
    ],
  },
  {
    version: "1.169.1",
    date: "2026-09-30",
    notes: [
      "Quick Create's New Appointment, New Job and New Contract now open their form straight away, instead of just opening the page. The same goes for the Appointment button on the phone's Today screen.",
    ],
  },
  {
    version: "1.169.0",
    date: "2026-09-30",
    notes: [
      "On a phone (and in the Android app), a lead now opens full screen. At the top: the address, where the lead came from and whose it is, big Call, Text, Email and Directions buttons, how far along the lead is, and the next appointment.",
      "The tabs (Overview, Appointments, Tasks, Notes, Texts, Calls, Files) come right after that, so a lead's texts or notes are one tap away instead of at the bottom of a long form. The contact details are on the Overview tab.",
      "Computers and tablets are unchanged.",
    ],
  },
  {
    version: "1.168.0",
    date: "2026-09-30",
    notes: [
      "On a phone (and in the Android app), the Leads tab is now a list of cards instead of the wide board. Pick a stage from the chips at the top; each lead shows its address, rep, job, value and age.",
      "Every lead card on a phone has Call, Text and Directions buttons. Call goes through the CRM's dialer so the call is logged, and Text opens the lead's text thread. A New lead button sits above the tabs.",
      "Quick Create's New Lead now opens the new contact form straight away, instead of just opening the Pipeline.",
    ],
  },
  {
    version: "1.167.0",
    date: "2026-09-30",
    notes: [
      "On a phone (and in the Android app), Home now opens on a short Today screen: big buttons for a new lead, an appointment, an estimate and the time clock, what needs your attention, your next appointments with a Navigate button to the address, and this month's leads and appointments against last month.",
      "The full dashboard is still there on a phone: tap \"Show the full dashboard\" at the bottom of Today. Computers and tablets are unchanged.",
      "The field crew's first tab on a phone is now Today, their time clock page, followed by Jobs, Schedule and Calendar.",
    ],
  },
  {
    version: "1.166.0",
    date: "2026-09-30",
    notes: [
      "New phone layout: on a phone (and in the Android app) there is now a colored tab bar at the bottom with your most-used pages. Office and sales get Home, Leads, Schedule and Jobs; the field crew gets Jobs, Schedule, Time and Calendar.",
      "The More tab opens every other page as colored tiles, plus the AI assistant, daily brief, dialer, screen share, your account and sign out. The top bar on a phone is now just search, Quick Create and the bell.",
      "The Quick Create button on a computer reads \"+ Quick Create\" again instead of \"+ Quick Create+\".",
    ],
  },
  {
    version: "1.165.2",
    date: "2026-09-30",
    notes: [
      "Dashboard on phones: the alert cards at the top (Overdue tasks, Overdue payments, Awaiting signature…) no longer run off the right side of the screen. On a small phone, or with a larger text size, they stack one per row so the full amount shows.",
    ],
  },
  {
    version: "1.165.1",
    date: "2026-09-30",
    notes: [
      "Behind the scenes: the Android phone app now needs Android 7 or newer, which Google Play requires. Phones from the last nine years are unaffected.",
    ],
  },
  {
    version: "1.165.0",
    date: "2026-09-30",
    notes: [
      "Production Board: a job moves to Complete by itself when the customer signs the completion certificate, with a \"✓ Certificate signed\" chip and the date. Jobs finished before today move over the first time you open the board.",
      "Putting a project on hold on the Projects page moves its card to On Hold, and dragging a card into or out of On Hold puts the project on or off hold. A voided contract's job leaves the board.",
      "A job with a crew moves to In Progress on its start date, with a \"Started\" chip.",
      "Dragging a card to Complete before the customer has signed now asks whether to raise the completion certificate first.",
      "The Complete column shows the last 30 days; \"Show older\" brings back the rest. The crew picker on a job, and the crew filter, list Field and Production people only.",
    ],
  },
  {
    version: "1.164.0",
    date: "2026-09-30",
    notes: [
      "Contacts has Source, Assigned Rep and Stage filters next to the search box. Tick as many as you like in each one, for example Google Ads and Google Organic together. \"Showing 312 of 6,743 contacts\" says how many match, and Clear all resets everything.",
      "The three numbers at the top of Contacts follow your search and filters, and clicking one narrows the list to it. Click No Rep Assigned to see only unassigned contacts, or With Open Leads to hide Won, Lost and DNC.",
      "Your filters stay in the page address, so refreshing or sending someone the link keeps them. Select all and Email Selected cover only the filtered contacts.",
      "Contacts owned by a rep who has since been deactivated now show that rep's name instead of \"Unassigned\".",
    ],
  },
  {
    version: "1.163.1",
    date: "2026-09-30",
    notes: [
      "Production Board: dragging a card to another column now works anywhere down the page. Before, a card far down a long column had nowhere to land — the other columns ended near the top — so the drop did nothing. Every column now runs the full height of the board.",
    ],
  },
  {
    version: "1.163.0",
    date: "2026-09-28",
    notes: [
      "Estimates & Contracts has a filter bar: search by customer, EST number, title or address, and pick a date range (last 7, 30 or 90 days, this month, last 12 months, or your own dates). The cards on top follow both, so Contracts can read \"signed this month\".",
      "Follow-up buttons on Drafts (No price yet, Older than 7 days) and Proposals (Not opened, Opened 3+ times, Expires within 7 days). Each shows how many documents it would leave.",
      "Click the Date, Views or Total column heading to sort the list; click again to flip it. Clear all resets every filter at once.",
    ],
  },
  {
    version: "1.162.1",
    date: "2026-09-28",
    notes: [
      "A printed Projects report showing just one job now saves under that job's estimate number (\"EST-1066 report\"), the same name as printing it from the job's own report — no more \"Projects report\" files you can't tell apart.",
    ],
  },
  {
    version: "1.162.0",
    date: "2026-09-27",
    notes: [
      "New Privacy and Delete account pages, linked at the bottom of the sign-in page and the side menu. Anyone can open them without signing in.",
      "In the phone app, the sign-up link and the subscription billing buttons no longer appear, as Google Play requires. On the website nothing changes.",
    ],
  },
  {
    version: "1.161.3",
    date: "2026-09-27",
    notes: [
      "Behind the scenes: the Android phone app can now be built for the Google Play Store. On newer Android phones, the app no longer draws the CRM under the clock and battery bar at the top.",
    ],
  },
  {
    version: "1.161.2",
    date: "2026-09-26",
    notes: [
      "Photos in a job's Photos window now fill their tiles. Before, portrait photos showed as narrow strips with a gap beside them.",
    ],
  },
  {
    version: "1.161.1",
    date: "2026-09-26",
    notes: [
      "Privacy fix: the client portal no longer sends the client's browser a list of staff from every company. It now sends only the names of the people shown on that client's page, with no emails or phone numbers.",
    ],
  },
  {
    version: "1.161.0",
    date: "2026-09-26",
    notes: [
      "The client portal has a new Notes tab: the project's written record, shared between the client and the team. Clients add notes and tag them Decision, Selection or Question. A note can't be changed once it's posted.",
      "On a contact's Notes tab, a switch now separates 🔒 Internal notes (never shown to the client) from 👁 Shared with client. On the shared side you can add a note, give the client a To-do, pin important notes, and answer the client's questions.",
      "When a client adds a note, the assigned rep and the office get a popup and a bell alert.",
    ],
  },
  {
    version: "1.160.0",
    date: "2026-09-25",
    notes: [
      "Office and Admin can delete a photo from a job's Photos window — tap the ✕ on its corner. A photo kept in Google Drive goes to Drive's trash for 30 days, so a mistake can be undone.",
      "Photo filed under the wrong job? \"Remove from job\" under it moves it back to the customer's unfiled photos without deleting anything.",
      "\"Deleted photos\" at the bottom of the Photos window shows who deleted which photo and when.",
    ],
  },
  {
    version: "1.159.0",
    date: "2026-09-25",
    notes: [
      "A company client is now named for the company everywhere — estimates, contracts, invoices, the customer's copy and PDF, Projects, Payments, P&L, commission, alerts and new Production jobs. Before, most of these showed the contact person instead.",
      "The contact person shows under the company: \"Contact: Josh Martinez\" on the estimate page and \"Attn: Josh Martinez\" on the customer's copy. On the signature line the person signs \"on behalf of\" the company.",
      "Emails and texts still greet the person by name.",
    ],
  },
  {
    version: "1.158.5",
    date: "2026-09-25",
    notes: [
      "A voided estimate or contract now says who voided it on its yellow banner — \"Voided on 9/18/2026 by Alex Morgan — reason\".",
    ],
  },
  {
    version: "1.158.4",
    date: "2026-09-25",
    notes: [
      "Fix: a company whose profile has no name filled in now also sends email under its own account name, never another company's name.",
    ],
  },
  {
    version: "1.158.3",
    date: "2026-09-25",
    notes: [
      "Fix: estimate, portal-link and bulk emails from a company that hasn't set up its own sender (Settings → Email) now show that company's name in the customer's inbox, not another company's name.",
    ],
  },
  {
    version: "1.158.2",
    date: "2026-09-25",
    notes: [
      "Fix: AI Estimator and AI Analysis now work when \"Claude Haiku 4.5 — fastest\" is the model picked in Settings. Before, Generate with AI, the AI line items, lead analysis and AI call notes all failed on Haiku with \"adaptive thinking is not supported on this model\".",
    ],
  },
  {
    version: "1.158.1",
    date: "2026-09-25",
    notes: [
      "Settings: the \"OpenAI API Key — Soon\" tile is gone. The CRM's AI features already work with no key to enter — just switch them on under Integrations & AI (AI Estimator, AI Analysis, AI Receptionist).",
      "Estimates: when Generate with AI, Format with AI or the AI line items can't finish, the message now says why (the AI key was rejected, the AI service is busy, or the reason the AI service gave, like an empty credit balance) instead of just \"Couldn't reach the AI right now.\"",
    ],
  },
  {
    version: "1.158.0",
    date: "2026-09-25",
    notes: [
      "Projects: every dollar on a job now opens right under its row. Click the ▸ next to the job name to see payments in, bills and costs out, and what's still owed on one timeline, grouped by month, with the receipts.",
      "Click Collected, Owed, Bills unpaid or Spent on a row to see just the lines behind that number. The 🧾 Bills chip now opens this list on the money going out, instead of a pop-up window.",
      "From the list you can Record payment on anything owed, Bill to client or ✎ Edit a cost, and add a bill or an invoice. The totals at the bottom always match the row.",
      "The printed project report (internal copy) now lists all transactions on one timeline too. The client copy is unchanged.",
    ],
  },
  {
    version: "1.157.2",
    date: "2026-09-25",
    notes: [
      "Fix: Settings → Portal Payments no longer says \"Connected\" when the saved Stripe key can't be read. It now says customers can't pay online and shows the boxes to paste your Stripe keys again. Before, Settings looked fine while customers got \"Online payment isn't switched on yet.\"",
    ],
  },
  {
    version: "1.157.1",
    date: "2026-09-25",
    notes: [
      "Fix: a customer with the deposit paid and a later payment billed (like completion) now sees it on their portal home — an amber \"$6,570.00 due\" chip and a Pay → button, instead of a green \"Deposit paid\" that made it look like nothing was owed.",
      "On the customer's contract page, a payment that's due now sits at the top, above the contract, instead of at the very bottom.",
      "Fix: a customer who opened the card page and backed out can pay again right away. Before, their Pay button turned into \"Bank transfer in progress\" for a full day.",
    ],
  },
  {
    version: "1.157.0",
    date: "2026-09-25",
    notes: [
      "New: invoice a customer for extras like a permit fee. Every project row has a green \"+ Invoice\" chip, and each paid bill in the job's 🧾 Bills window has \"Bill to client\", which fills in the invoice with that cost.",
      "Invoices need no signature. Send by text and the customer gets a Pay link; they see the lines, the receipt for each billed cost, and a Pay button in their portal. A check or cash is recorded with Record payment, same as a contract.",
      "Invoices count as money in on Payments, Money to Collect, Projects and Profit & Loss. They are not sales, so the sales totals and rep commission don't change.",
      "Billed costs are at cost unless you tick \"Add markup\". A cost can't be billed twice, and an invoice sent by mistake can be cancelled from its page until money comes in on it.",
      "Quick Create → New Invoice now works: search for the customer, with or without a contract.",
    ],
  },
  {
    version: "1.156.1",
    date: "2026-09-25",
    notes: [
      "The client portal's browser tab now shows your company logo, the same one at the top of the page, instead of the old AI Build Pros icon.",
    ],
  },
  {
    version: "1.156.0",
    date: "2026-09-25",
    notes: [
      "Settings → Users & Roles has a new Send Without Approval switch. Turn it on for a closer (or anyone you trust to price a job) and, while estimate approval is switched on, their estimates go straight to the customer instead of waiting for an Admin.",
      "Their send still counts as the approval, in their name: the contact's history notes that they sent it without waiting for an Admin.",
      "Only an Admin can turn this switch on or off. Everyone else's estimates still wait for approval as before.",
    ],
  },
  {
    version: "1.155.0",
    date: "2026-09-25",
    notes: [
      "The client portal has a fresh, more colourful look: your customers now land on a dark branded banner with their name, and each section has its own colour and icon.",
      "Project status shows a progress bar and \"Step 3 of 5\", and the estimate shows coloured tags (Signed, Deposit paid, deposit due) so customers see where things stand at a glance.",
      "With nothing booked, customers get a one-tap Call button; licences and insurance show as tiles; social links wear each network's own colour, and the review stars are now gold.",
    ],
  },
  {
    version: "1.154.0",
    date: "2026-09-24",
    notes: [
      "Settings → Facebook Lead Ads has a Connect with Facebook button: sign in with the account that runs your business Page (Business Manager is fine), pick the Page, and its lead-form leads start arriving in Contacts & Leads. No developer app or tokens to copy.",
      "The same page now tells you when Facebook stops accepting the connection, with a Reconnect button, instead of leads quietly stopping.",
      "Switch Page or Disconnect from the same card. The old manual setup is still there under Advanced for anyone already using it.",
    ],
  },
  {
    version: "1.153.0",
    date: "2026-09-24",
    notes: [
      "New Settings → PrimeCall Phone System: connect your PrimeCall office phones, and every call in or out shows up in Call Reports and on the caller's contact card, with the recording to play.",
      "Someone who calls your PrimeCall number and isn't in the CRM yet becomes a new lead in Unsorted, and the office gets the usual new-lead text.",
      "Each call is credited to the person whose email matches their PrimeCall extension. The settings page shows which extension belongs to whom.",
    ],
  },
  {
    version: "1.152.0",
    date: "2026-09-24",
    notes: [
      "+ Add bill now asks \"Paid?\": Not paid yet, Paid in part, or Paid in full. For each payment, pick how it was paid (Check, Card, Cash, Zelle, ACH, Wire or Other), the account it came from, the check or reference number, and the date. You can add as many payments as needed, for example $800 on the card and $300 by check. Whatever isn't paid yet waits in Bills to Pay.",
      "New Settings → Payment Accounts: list the bank accounts, cards and cash you pay vendors from. They appear as \"Paid from\" when you add a bill, and in Bills to Pay's Pay window.",
      "In Bills to Pay you can now edit a bill that's already paid or part paid (vendor, job, what it was for, or a larger total). The job's costs update to match.",
      "Bills are now recorded the way QuickBooks records them (one bill, with a payment for each payment), so they'll be ready when QuickBooks sync is added.",
    ],
  },
  {
    version: "1.151.0",
    date: "2026-09-24",
    notes: [
      "A project's 🧾 Bills window now shows which contract each paid bill counts toward, when the customer has more than one contract. Bills not assigned to any contract get a yellow warning, because sales commission doesn't count them. Click \"Assign all to EST-…\", or the button on one row, to put them on that project's contract.",
      "The bottom of that window also shows how much is counted on this project's contract (the figure its commission uses) next to the total across all contracts.",
    ],
  },
  {
    version: "1.150.0",
    date: "2026-09-24",
    notes: [
      "Commission statement: a new Job picker shows one job's commission on its own. It lists the contract, lead cost, every bill, net profit, the commission pool and each salesperson's share. It also shows what's still needed before it can be paid, the customer's payments, and what's already been paid out. Click any job name on the statement to open the same view.",
      "When a customer has more than one contract, + Add bill and ✎ Edit now ask \"Which contract?\". From a project row, it's picked for you. Before this, those bills counted toward none of the customer's contracts, so the commission said \"Job costs not recorded yet\".",
      "Bills already saved without a contract are now flagged on the commission statement, with a link to assign them.",
    ],
  },
  {
    version: "1.149.0",
    date: "2026-09-24",
    notes: [
      "Bills you saved as \"Already paid\" now have an ✎ Edit button, both in Bills to Pay → Paid and in a project's 🧾 Bills window. Fix the job, vendor, what it was for, the amount, the date paid or the receipt, or delete the bill.",
      "Paid bills saved without a receipt show a 📎 Attach button. Click it or drop the photo or PDF on it.",
      "Bills synced from QuickBooks stay locked, because the next sync would undo an edit.",
      "The count on the selected tab (for example Paid) is readable again. It was white on white.",
    ],
  },
  {
    version: "1.148.0",
    date: "2026-09-23",
    notes: [
      "Bills to Pay → Paid now also lists the bills you saved on a project with \"Already paid\" switched on, under \"Paid on entry\", with the receipt, vendor, job, date paid and amount. They show there read-only; change or remove one from the project's Bills.",
    ],
  },
  {
    version: "1.147.1",
    date: "2026-09-23",
    notes: [
      "Customer deposits now always go into your company's own Stripe account, connected under Settings → Portal Payments. A company that hasn't connected one doesn't show an online Pay button, instead of falling back to the AI Build Pros account.",
    ],
  },
  {
    version: "1.147.0",
    date: "2026-09-23",
    notes: [
      "New Settings → Subscription page: Office and Admin users can update the card the AI Build Pro plan is paid with, download invoices, or cancel.",
      "If a card payment for the subscription fails, a yellow notice across the top says so while Stripe retries. If the subscription ends, the CRM locks and shows a page to renew it. Nothing is deleted, and everything comes back the moment it's renewed.",
    ],
  },
  {
    version: "1.146.0",
    date: "2026-09-23",
    notes: [
      "Every estimate now shows its rep at the top, next to the customer's name and address. Until it's signed, the rep is whoever holds the lead, and a link opens the lead card to change it. A signed contract shows the rep who sold it.",
    ],
  },
  {
    version: "1.145.2",
    date: "2026-09-23",
    notes: [
      "Estimate Status now shows an unsigned estimate under the rep who holds the customer today. Before, it stayed under whoever held the lead when the estimate was made, so filtering by rep showed estimates that had since been handed to someone else. Signed contracts still stay with the rep who sold them.",
    ],
  },
  {
    version: "1.145.1",
    date: "2026-09-23",
    notes: [
      "The CRM phone app now carries the AI Build Pros logo on its icon and its opening screen, instead of a placeholder.",
    ],
  },
  {
    version: "1.145.0",
    date: "2026-09-23",
    notes: [
      "The CRM is getting its own phone app. Clocked in from the app, your location keeps being shared with your phone locked or in your pocket, so arrivals at jobs are logged without opening the CRM. On Android an \"On the clock\" notification shows while it's sharing. Sharing still stops the moment you clock out.",
      "If location is blocked for the app, the \"On the clock\" pill turns orange with an Open settings button.",
    ],
  },
  {
    version: "1.144.0",
    date: "2026-09-23",
    notes: [
      "New Time Clock (Staff menu): clock in, take a break and clock out from your phone. While you're on the clock the CRM shares your location and logs your arrival at each appointment automatically. Sharing stops when you clock out.",
      "New Team Map for the office: everyone on the clock, live — at a job, driving, stopped somewhere else, or location off.",
      "New Timesheets for the office: weekly hours per person, time on site, late arrivals, overtime and missed clock-outs, with a Fix button that keeps a permanent history of every change, and a CSV export for payroll.",
      "Settings › Time Clock & Tracking: choose who clocks in, the job-zone size, overtime and late rules, the office address, and how long location trails are kept.",
    ],
  },
  {
    version: "1.143.0",
    date: "2026-09-23",
    notes: [
      "The sidebar's standard order is now Dashboard, Marketing Analytics, Dispatch Dashboard, Calendar, Schedule, Estimates & Contracts, Production, Accounting, Dispatch, Call Center, Staff, Estimate Status, Estimate Approvals — and \"Reset to standard order\" on Settings › Menu Order goes back to exactly that.",
    ],
  },
  {
    version: "1.142.0",
    date: "2026-09-23",
    notes: [
      "Estimate Status shows who's on each document: Closer, Rep 1 and Rep 2 columns sit between the document and the customer, so the table fills the screen instead of leaving a gap.",
      "A new Client view column says whether the customer has opened the document (and when), or that it was sent and not opened yet, with a Preview link that opens what the customer sees.",
      "Filters above the table: Status, Closer, Rep (matches either seat) and a customer search, with an 'N of M in flight' count and a Clear button. Closer and Rep lists only offer people who have documents on the board.",
    ],
  },
  {
    version: "1.141.1",
    date: "2026-09-23",
    notes: [
      "Settings › Google Calendar is easier to read: the two connection cards match the rest of Settings, the text is normal size instead of small italics, and the Connect button sits inside its card instead of hanging off the bottom edge.",
    ],
  },
  {
    version: "1.141.0",
    date: "2026-09-23",
    notes: [
      "Google Calendar sync, both ways. Open Settings › Google Calendar (or the 📆 Google Calendar button on the Calendar page) and connect your own Google account: your appointments appear on your Google Calendar with the client, address, notes and a link back to the CRM.",
      "Move or resize an appointment in Google and the CRM follows; delete it in Google and the CRM marks it Cancelled. Cancelled and No-show appointments come off Google, and reassigning one moves it to the new rep's calendar.",
      "Office and Admin users can also connect one company-wide Google Calendar that receives every appointment.",
      "Syncs run every 15 minutes, with a Sync now button for right away. Events you create yourself in Google are never copied into the CRM.",
      "Requires a Google OAuth client on the deployment and migration 0173 in Supabase; until then the page says what's missing.",
    ],
  },
  {
    version: "1.140.0",
    date: "2026-09-22",
    notes: [
      "Platform Admin has a new Invite History card under Invite a Business: every setup link ever sent, paid or by hand, newest first, with the email, the company it became, who sent it, when, and a status chip — Set up, Pending (with the day it expires), Expired, or Send failed.",
      "Tabs narrow the list by status and a search box finds an invite by email or company name.",
      "Resend on a Pending, Expired or Send failed invite puts a fresh link in the same inbox (the old link stops working); Open company on a Set up invite jumps straight into that company.",
      "Manual invites now record which admin sent them (after migration 0172 is run in Supabase; until then the Sent by column shows a dash).",
    ],
  },
  {
    version: "1.139.0",
    date: "2026-09-22",
    notes: [
      "Dispatch Dashboard is now its own item in the sidebar, right under Dashboard, instead of a row inside the Dispatch section. Like every top-level item, an admin can move it in Settings › Menu Order.",
      "If your company has a saved menu order, the new item appears at the bottom of the menu once; drag it where you want it in Settings › Menu Order.",
    ],
  },
  {
    version: "1.138.0",
    date: "2026-09-22",
    notes: [
      "New Dispatch Dashboard, first in the Dispatch section of the sidebar: the desk's own overview of new leads coming in and appointments going out.",
      "It opens with what needs attention right now: new leads nobody has called or texted (and how long the oldest has waited), replies waiting, overdue follow-ups, today's appointments not yet confirmed, past appointments still missing a result, and the unclaimed pool. Every card opens the page that lists its rows.",
      "Below that, the period's pace with change against the previous period: new leads, how many were reached within an hour (and the typical time to first call or text), appointments booked, show rate, and dials with the connect rate.",
      "Then today's board with a confirmation pill per visit, the next seven days on the calendar, leads still waiting for a first appointment by age, call outcomes, and a per-dispatcher desk table with a booking rate.",
      "Dispatch users see it by default; other roles can be given it in Settings › Role Visibility. A dispatcher who is not a supervisor sees only their own numbers.",
    ],
  },
  {
    version: "1.137.0",
    date: "2026-09-22",
    notes: [
      "The appointment window's Estimates tab now has a \"Write estimate for …\" button: one tap creates the estimate for that customer and opens it ready to price -- no more leaving the appointment to go hunt for New Estimate.",
    ],
  },
  {
    version: "1.136.0",
    date: "2026-09-22",
    notes: [
      "The Reply Inbox is live: when a customer texts back (a YES, a question, anything), the open conversation updates by itself within about 20 seconds -- no more refreshing the page to see the reply. Your selected thread and a half-typed reply stay put while it updates.",
    ],
  },
  {
    version: "1.135.1",
    date: "2026-09-22",
    notes: [
      "Fixed: texting a contact for the first time from an appointment's Send SMS no longer says \"No phone number to send to\" -- the composer now keeps the contact's name and number, and it also finds a number saved under the second contact.",
    ],
  },
  {
    version: "1.135.0",
    date: "2026-09-22",
    notes: [
      "The sidebar's \"Dispatch (Leads Mgmt.)\" is now just \"Dispatch\", so the heading fits on one line next to the unread count.",
      "\"Appt. Setter Assignments\" reads \"Setter Assignments\" in the sidebar. Same page, same address; the page's own title is unchanged.",
      "The greyed \"Dispatch Dashboard · Soon\" row is gone from the sidebar until that page exists. It was the only row that did nothing when tapped.",
      "If you had arranged the menu in Settings › Menu Order, Dispatch stays where it was.",
    ],
  },
  {
    version: "1.134.0",
    date: "2026-09-22",
    notes: [
      "The sidebar's \"Your Sales Center\" is now called \"Call Center\": the Power Dialer and the call, text and appointment reports, named after the people who use them.",
      "Salespeople (the rep leaderboard) has its own new \"Staff\" section in the sidebar, right under Call Center. Same page, same address, just a home that fits.",
      "Every sidebar section now has its own color on its icon and left edge (Dispatch blue, Call Center teal, Staff rose, Production orange, Accounting gold), so you can spot a section without reading it.",
      "If you had arranged the menu in Settings › Menu Order, Call Center and Staff sit where Your Sales Center was. Nothing else moved.",
    ],
  },
  {
    version: "1.133.0",
    date: "2026-09-22",
    notes: [
      "The appointment and contact cards are now linked: save an appointment and its Assigned To / Second Assigned To fill the customer's empty Assigned Rep and Partner Rep seats automatically, with a note on the timeline saying so. A seat someone already holds is never overwritten, and the Closer never changes from an appointment.",
      "Booking is faster: new appointments start with the customer's own rep pre-picked, and an old appointment with an empty rep box gets a one-tap \"Use customer's rep\" button.",
      "Reminder texts have a safety net: a visit with nobody booked now texts the customer's rep instead of texting no one.",
    ],
  },
  {
    version: "1.132.0",
    date: "2026-09-22",
    notes: [
      "Every update now announces itself: after a new version goes live, a What's new screen lists what changed the first time you open the CRM, and the update popup on older tabs shows the same list before you refresh.",
      "The version in the sidebar now changes with every update, so \"which version are you on?\" always has a real answer.",
    ],
  },
];

/** The newest entry -- the version this codebase is at. */
export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The entry for one version, or null when none was written for it. */
export function notesForVersion(version: string): ReleaseNote | null {
  return RELEASE_NOTES.find((r) => r.version === version) ?? null;
}

/**
 * Should the What's new screen open for the build this browser just
 * loaded? Once per version per browser: `seen` is the version the
 * person last pressed "Got it" on (null when they never have). A build
 * with no note written has nothing to announce.
 */
export function shouldShowWhatsNew(loaded: string, seen: string | null): boolean {
  if (!notesForVersion(loaded)) return false;
  return seen !== loaded;
}
