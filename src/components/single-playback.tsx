"use client";

import { useEffect } from "react";

/** Pause any other <audio> on the page when one starts playing. */
export function SinglePlayback() {
  useEffect(() => {
    const onPlay = (e: Event) => {
      document.querySelectorAll("audio").forEach((a) => {
        if (a !== e.target) a.pause();
      });
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);
  return null;
}
