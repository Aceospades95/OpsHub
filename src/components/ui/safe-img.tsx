"use client";

import { useEffect, useState } from "react";

/**
 * <img> with broken-URL caching.
 *
 * Real-environment QA flagged a 22+ requests-per-page-load spam on
 * `/api/files/<id>` for an id that 404s every time — the file row
 * was deleted but stale references (logo, avatar, etc.) still point
 * at it, so every component that renders the URL kicks off a fresh
 * GET, every navigation re-renders, and the browser dutifully
 * re-requests because the previous failure was a network response,
 * not a DNS error.
 *
 * This component remembers which URLs 404'd in a module-scoped Set
 * for the lifetime of the session. On first onError we skip the img
 * and render `fallback`. Every subsequent mount with the same src
 * skips the network entirely.
 *
 * Use anywhere we'd otherwise write `<img src={maybeBrokenUrl} … />`.
 * Branding logo, user avatar, file thumbnails — all the same shape.
 */

const KNOWN_BROKEN = new Set<string>();

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
  /** Rendered when the URL is known-broken or 404s on first try. */
  fallback?: React.ReactNode;
}

export function SafeImg({ src, fallback = null, alt = "", ...rest }: Props) {
  const [broken, setBroken] = useState<boolean>(() => KNOWN_BROKEN.has(src));

  // If a different src comes in, check the cache fresh.
  useEffect(() => {
    setBroken(KNOWN_BROKEN.has(src));
  }, [src]);

  if (broken) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => {
        KNOWN_BROKEN.add(src);
        setBroken(true);
      }}
      {...rest}
    />
  );
}

/**
 * Test helper — clears the broken-URL cache. Not exported for
 * production use; the cache should persist for the session.
 */
export function _clearKnownBrokenCacheForTests(): void {
  KNOWN_BROKEN.clear();
}
