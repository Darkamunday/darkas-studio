"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While songs are cooking, re-render the catalogue every few seconds so they appear when done. */
export function PendingRefresher() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
