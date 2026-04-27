"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

/**
 * Client-side lazy wrapper for `CountriesMap`.
 *
 * react-simple-maps + d3-geo (~90KB JS) plus a 120KB TopoJSON file
 * are the single heaviest dependency on the analytics page. Server-
 * rendering the map adds nothing the user can act on (the SVG is the
 * same shape every time, the bubbles are the only data) and forces
 * every analytics navigation to ship those bytes.
 *
 * `ssr: false` skips it on the server: the page HTML carries a
 * skeleton sized to the map's viewport so layout doesn't shift, and
 * the chunk + TopoJSON load in parallel after hydration.
 */
const CountriesMap = dynamic(
  () => import("./analytics-map").then((m) => m.CountriesMap),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="aspect-[2/1] w-full rounded-xl" />
    ),
  },
);

export { CountriesMap };
