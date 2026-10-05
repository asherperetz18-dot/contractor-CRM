"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { recheckBilling } from "@/lib/actions/billing";

/**
 * Back from Stripe's billing page during a free trial: a card added there
 * lands on Stripe with no event this app listens for, so this asks Stripe
 * once and redraws the page -- the "add a card" prompt and the banner go
 * the moment the card is there (DECISIONS #129).
 */
export function TrialCardCheck() {
  const router = useRouter();
  useEffect(() => {
    void recheckBilling().then(() => router.refresh());
  }, [router]);
  return null;
}
