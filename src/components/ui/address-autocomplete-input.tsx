"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: {
              types?: string[];
              fields?: string[];
              componentRestrictions?: { country: string | string[] };
            }
          ) => {
            addListener: (event: string, handler: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              address_components?: { long_name: string; short_name: string; types: string[] }[];
            };
          };
        };
      };
    };
  }
}

let loadPromise: Promise<void> | null = null;

function loadGooglePlaces(apiKey: string): Promise<void> {
  if (window.google?.maps?.places) return Promise.resolve();
  if (loadPromise) return loadPromise;
  // Deliberately not using loading=async here: that mode defers loading
  // the "places" sub-library until an explicit importLibrary() call, which
  // requires Google's inline bootstrap snippet to work (a bare <script> tag
  // doesn't get that shim). Classic loading with libraries=places blocks
  // until Autocomplete is actually ready before firing onload.
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export function AddressAutocompleteInput({
  value,
  onChange,
  onZipChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (address: string) => void;
  onZipChange?: (zip: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onZipChangeRef = useRef(onZipChange);

  useEffect(() => {
    onChangeRef.current = onChange;
    onZipChangeRef.current = onZipChange;
  });

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !inputRef.current) return;
    let cancelled = false;

    loadGooglePlaces(apiKey)
      .then(() => {
        if (cancelled || !inputRef.current || !window.google?.maps?.places) return;
        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ["address"],
          fields: ["formatted_address", "address_components"],
          componentRestrictions: { country: "us" },
        });
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (place.formatted_address) onChangeRef.current(place.formatted_address);
          const zipComponent = place.address_components?.find((c) =>
            c.types.includes("postal_code")
          );
          if (zipComponent && onZipChangeRef.current) {
            onZipChangeRef.current(zipComponent.long_name);
          }
        });
      })
      .catch(() => {
        // Falls back to a plain text input if the script can't load.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
    />
  );
}
