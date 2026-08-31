import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTwilioForCompany } from "@/lib/twilio-company";
import {
  CALLRAIL_API_BASE,
  callrailAuthHeader,
  getCallRailForCompany,
} from "@/lib/callrail-company";

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
    .select("recording_url, company_id, callrail_call_id")
    .eq("id", id)
    .maybeSingle<{
      recording_url: string | null;
      company_id: string;
      callrail_call_id: string | null;
    }>();
  const recordingUrl = data?.recording_url;
  if (!recordingUrl) return NextResponse.json({ error: "No recording." }, { status: 404 });

  // CallRail calls: the stored URL is their dashboard player, which
  // demands a CallRail login nobody's reps have. Their API hands out a
  // short-lived direct media URL instead -- fetched with the company's
  // key, streamed here, so the same inline player serves both providers.
  if (data.callrail_call_id) {
    const creds = await getCallRailForCompany(data.company_id);
    if (!creds) return NextResponse.json({ error: "CallRail not configured." }, { status: 500 });

    const metaRes = await fetch(
      `${CALLRAIL_API_BASE}/a/${encodeURIComponent(creds.accountId)}/calls/${encodeURIComponent(data.callrail_call_id)}/recording.json`,
      { headers: callrailAuthHeader(creds.apiKey) }
    );
    if (!metaRes.ok) {
      // The upstream status is the whole diagnosis: 401/403 means the
      // stored API key no longer works (rotated at CallRail without
      // being re-saved here), 404 means this call has no recording.
      return NextResponse.json(
        { error: `Could not fetch recording (CallRail answered ${metaRes.status}).` },
        { status: 502 }
      );
    }
    const meta = (await metaRes.json()) as { url?: string };
    if (!meta.url) return NextResponse.json({ error: "No recording." }, { status: 404 });

    // Plain first -- the media URL is normally pre-signed. If that is
    // refused, retry carrying the API key: CallRail has served both
    // shapes, and a header S3 would reject is only sent after the
    // plain fetch already failed.
    let audio = await fetch(meta.url);
    if (!audio.ok) {
      audio = await fetch(meta.url, { headers: callrailAuthHeader(creds.apiKey) });
    }
    if (!audio.ok || !audio.body) {
      return NextResponse.json(
        { error: `Could not fetch recording (media answered ${audio.status}).` },
        { status: 502 }
      );
    }
    return new NextResponse(audio.body, {
      status: 200,
      headers: {
        "Content-Type": audio.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

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
