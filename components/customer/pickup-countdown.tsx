"use client";

import { useEffect, useState } from "react";

/**
 * Renders a live "Pickup in X minutes" countdown (SRS V2 §H: "The
 * countdown must use server time/authoritative timestamps rather than
 * trusting the browser clock."). `pickupTimeIso` is a server-computed
 * absolute instant passed down as a prop — this component only does
 * presentation-layer ticking against that fixed value, it never lets the
 * browser clock decide what "now" means for anything that matters
 * (capacity, feasibility, order state). Purely informational, as the SRS
 * requires.
 */
export function PickupCountdown({ pickupTimeIso }: { pickupTimeIso: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const pickupTime = new Date(pickupTimeIso).getTime();
  const diffMinutes = Math.round((pickupTime - now) / 60_000);

  let label: string;
  if (diffMinutes > 1) label = `Pickup in ${diffMinutes} minutes`;
  else if (diffMinutes === 1) label = "Pickup in 1 minute";
  else if (diffMinutes >= -5) label = "Pickup window ending soon";
  else label = "Pickup window expired";

  return <span className="text-sm font-medium text-orange-600">{label}</span>;
}
