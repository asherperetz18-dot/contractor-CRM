import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTwilioForCompany } from "@/lib/twilio-company";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // maybeSingle, not single: a call belonging to another company is
  // filtered out by row-level security, and single() turns that into a
  // 500 rather than the "no recording" it actually is.
  const { id } = await params;
  const { data } = await supabase
    .from("call_logs")
    .select("recording_url, company_id")
    .eq("id", id)
    .maybeSingle<{ recording_url: string | null; company_id: string }>();
  const recordingUrl = data?.recording_url;
  if (!recordingUrl) return NextResponse.json({ error: "No recording." }, { status: 404 });

  // Fetched with the credentials of the company that recorded it. Twilio
  // only serves a recording to the account that owns it, so playing back
  // a second company's call with the platform account answered 401 and
  // surfaced as a player that simply refused to start.
  const twilioEnv = await getTwilioForCompany(data.company_id);
  if (!twilioEnv) return NextResponse.json({ error: "Twilio not configured." }, { status: 500 });

  const basicAuth = Buffer.from(`${twilioEnv.accountSid}:${twilioEnv.authToken}`).toString(
    "base64"
  );
  const twilioRes = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${basicAuth}` },
  });
  if (!twilioRes.ok || !twilioRes.body) {
    return NextResponse.json({ error: "Could not fetch recording." }, { status: 502 });
  }

  return new NextResponse(twilioRes.body, {
    status: 200,
    headers: {
      "Content-Type": twilioRes.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
