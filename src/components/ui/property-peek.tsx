"use client";

import { useState } from "react";
import { mapsUrl } from "@/lib/data/types";

/**
 * A look at the property from its address: a Street View photo (the
 * Maps key already on this app powers it) and a Zillow deep link, which
 * is as close as anyone can get to the value -- Zillow retired its
 * public API, so the Zestimate lives one click away rather than inline.
 *
 * Street View answers "no imagery here" with a grey placeholder rather
 * than an error, so the photo can look empty on rural addresses; the
 * links below it always work.
 */
export function PropertyPeek({ address }: { address: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const zillowUrl = `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;

  return (
    <div className="field property-peek">
      <span className="field-label">Property</span>
      {key && !imgFailed && (
        <a href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" title="Open in Google Maps">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://maps.googleapis.com/maps/api/streetview?size=400x180&location=${encodeURIComponent(address)}&source=outdoor&key=${key}`}
            alt={`Street view of ${address}`}
            className="property-peek-img"
            onError={() => setImgFailed(true)}
          />
        </a>
      )}
      <a
        className="property-peek-zillow"
        href={zillowUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        View on Zillow — property &amp; value →
      </a>
    </div>
  );
}
