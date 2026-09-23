import { getGoogleCalendarStatus } from "@/lib/actions/google-calendar";
import { getCurrentProfile } from "@/lib/data/profile";
import { GoogleCalendarView } from "./google-calendar-view";

// Not behind AdminGate: every signed-in person may connect their OWN
// Google account here (the Calendar page links them in). The company
// calendar section inside the view is what stays Office/Admin only.
export default async function GoogleCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error, connected } = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const status = await getGoogleCalendarStatus();
  return <GoogleCalendarView status={status} connectError={error} justConnected={connected} />;
}
