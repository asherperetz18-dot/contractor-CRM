import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTwilioEnv } from "@/lib/twilio-env";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const { data } = await supabase
    .from("call_logs")
    .select("recording_url")
    .eq("id", id)
    .single();
  const recordingUrl = (data as { recording_url: string | null } | null)?.recording_url;
  if (!recordingUrl) return NextResponse.json({ error: "No recording." }, { status: 404 });

  const twilioEnv = getTwilioEnv();
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
