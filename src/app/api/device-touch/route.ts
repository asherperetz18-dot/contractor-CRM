import { NextResponse } from "next/server";
import { touchDevice } from "@/lib/actions/devices";

/**
 * The device heartbeat, as a route handler rather than a Server Action,
 * for the same reason as /api/popup-alerts: it rides the 30-second
 * activity heartbeat on every working tab, and the action path re-runs
 * the whole layout per ask. Auth is the action's own -- caller's cookie
 * session; a signed-out caller upserts nothing and is never "revoked".
 */
export async function POST(request: Request) {
  let body: { deviceId?: unknown; userAgent?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({});
  }
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const userAgent = typeof body.userAgent === "string" ? body.userAgent : "";
  const label = typeof body.label === "string" ? body.label : "";
  if (!deviceId) return NextResponse.json({});
  return NextResponse.json(await touchDevice(deviceId, userAgent, label));
}
