/**
 * What a <WebOnly> block renders, given whether the page is running
 * inside the phone app (`null` until the browser has said).
 *
 * The unknown state renders nothing, not the content: a sales link that
 * flashed for one frame inside the app is still a sales link in the
 * screenshot a Play reviewer takes.
 */
export function webOnlyView(inApp: boolean | null): "nothing" | "content" | "fallback" {
  if (inApp === null) return "nothing";
  return inApp ? "fallback" : "content";
}
