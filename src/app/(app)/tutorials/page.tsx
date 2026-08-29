import { TutorialsView } from "./tutorials-view";

export const dynamic = "force-dynamic";

/**
 * The help library: short narrated walkthroughs of the CRM, built from
 * real screens of a demo company. Deliberately outside the role
 * visibility matrix -- help is for everyone, and a page someone cannot
 * reach is exactly where "how do I..." questions come from.
 */
export default function TutorialsPage() {
  return <TutorialsView />;
}
