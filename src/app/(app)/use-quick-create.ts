"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { shouldOpenQuickCreate } from "@/lib/data/quick-create";

/**
 * A page's "new" form, opened by itself when Quick Create (or the phone
 * Today screen) lands here with ?new=1. Returns the form's open state in
 * place of the page's own useState.
 *
 * The estimates page's idiom (it has two such forms, so it keeps its
 * own copy): the open happens during render behind a consumed guard,
 * since lint forbids setState inside an effect, and the effect strips
 * the param so a refresh or a copied link doesn't reopen the form. With
 * the param gone the guard resets, so the next Quick Create click (which
 * puts ?new=1 back) opens it again.
 */
export function useQuickCreate(path: string, canCreate: boolean) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const newParam = searchParams.get("new");
  if (newParam && !consumed) {
    setConsumed(true);
    if (shouldOpenQuickCreate(newParam, canCreate)) setOpen(true);
  } else if (!newParam && consumed) {
    setConsumed(false);
  }
  useEffect(() => {
    if (searchParams.get("new")) router.replace(path, { scroll: false });
  }, [searchParams, router, path]);
  return [open, setOpen] as const;
}
