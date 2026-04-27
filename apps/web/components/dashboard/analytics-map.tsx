"use client";

/**
 * World map for the "Top countries" card.
 *
 * Choices made and why:
 *   - react-simple-maps (~30kb) + TopoJSON 110m (~120kb fetched once,
 *     cached) is the lightest serious option. Pure-SVG static maps
 *     can't do choropleth fills cleanly across browsers; full WebGL
 *     globes (cobe) look great but feel out-of-place in a 2-up grid
 *     next to a horizontal bar chart.
 *   - Bubble markers (sized by visit count) over a muted base map
 *     instead of a choropleth. With 2-3 countries having data, a
 *     choropleth looks sparse — bubbles read as "presence" instead.
 *   - Tooltip + the country list rendered alongside the map so the
 *     user keeps the precise numbers without hovering each bubble.
 */

import * as React from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { countryFlag, countryName } from "./format";

interface CountryDatum {
  country: string; // ISO-3166-1 alpha-2
  views: number;
}

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

/**
 * Approximate centroids for the country codes we serve (ISO-3166-1 alpha-2 →
 * [longitude, latitude]). Covers the same set as `format.ts:COUNTRY_NAMES`
 * plus a handful of common visitors. Anything missing falls back to (0, 0)
 * which we hide; the country still appears in the list below.
 */
const CENTROIDS: Record<string, [number, number]> = {
  US: [-98.5, 39.8],
  IN: [78.9, 22.0],
  GB: [-1.5, 53.0],
  CA: [-106.3, 56.1],
  DE: [10.5, 51.2],
  FR: [2.2, 46.6],
  JP: [138.3, 36.2],
  AU: [134.5, -25.7],
  BR: [-51.9, -14.2],
  NL: [5.3, 52.1],
  SG: [103.8, 1.3],
  CN: [104.2, 35.9],
  RU: [105.3, 61.5],
  ES: [-3.7, 40.4],
  IT: [12.6, 41.9],
  MX: [-102.6, 23.6],
  KR: [127.8, 36.0],
  IE: [-8.2, 53.4],
  SE: [18.6, 60.1],
  NO: [8.5, 60.5],
  CH: [8.2, 46.8],
  PL: [19.1, 51.9],
  TR: [35.2, 39.0],
  AE: [54.0, 23.4],
  IL: [34.9, 31.0],
  ZA: [22.9, -30.6],
  AR: [-63.6, -38.4],
  PH: [121.8, 12.9],
  ID: [113.9, -0.8],
  VN: [108.3, 14.1],
  TH: [101.0, 15.9],
  MY: [101.9, 4.2],
  PK: [69.3, 30.4],
  BD: [90.4, 23.7],
  EG: [30.8, 26.8],
  NG: [8.7, 9.1],
  KE: [37.9, -0.0],
  CO: [-74.3, 4.6],
  CL: [-71.5, -35.7],
  PT: [-8.2, 39.4],
  BE: [4.5, 50.5],
  AT: [14.6, 47.5],
  DK: [9.5, 56.3],
  FI: [25.7, 61.9],
  CZ: [15.5, 49.8],
  GR: [21.8, 39.1],
  RO: [25.0, 45.9],
  HU: [19.5, 47.2],
  UA: [31.2, 48.4],
  NZ: [172.8, -41.5],
  TW: [120.9, 23.7],
  HK: [114.1, 22.4],
};

/**
 * Compute a marker's pixel radius from view count. Square-root scaling
 * so a country with 10x the traffic looks ~3x as big — closer to how
 * humans read scaled circles.
 */
function radiusFor(views: number, max: number): number {
  if (max <= 0) return 0;
  const t = Math.sqrt(views / max);
  return 4 + t * 12; // 4–16px
}

export function CountriesMap({ rows }: { rows: CountryDatum[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 bg-muted/15 px-3 py-3 text-[12px] text-muted-foreground">
        We&apos;ll show where visitors are reading from once traffic comes in.
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.views));
  const totalViews = rows.reduce((acc, r) => acc + r.views, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-center">
      <div className="-mx-2">
        <ComposableMap
          projectionConfig={{ scale: 145 }}
          width={780}
          height={380}
          style={{ width: "100%", height: "auto" }}
        >
          <Geographies geography={TOPO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="currentColor"
                  fillOpacity={0.06}
                  stroke="currentColor"
                  strokeOpacity={0.15}
                  strokeWidth={0.5}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none", fillOpacity: 0.1 },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>
          {rows.map((r) => {
            const coords = CENTROIDS[r.country.toUpperCase()];
            if (!coords) return null;
            const radius = radiusFor(r.views, max);
            return (
              <Marker key={r.country} coordinates={coords}>
                <circle
                  r={radius}
                  fill="var(--chart-1)"
                  fillOpacity={0.18}
                  stroke="var(--chart-1)"
                  strokeWidth={0.6}
                  strokeOpacity={0.7}
                />
                <circle r={Math.max(2, radius * 0.35)} fill="var(--chart-1)" />
                <title>{`${countryName(r.country)} — ${r.views.toLocaleString()} views`}</title>
              </Marker>
            );
          })}
        </ComposableMap>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const pct = totalViews > 0 ? Math.round((r.views / totalViews) * 100) : 0;
          return (
            <li
              key={r.country}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-[15px] leading-none">
                {countryFlag(r.country)}
              </span>
              <span className="flex-1 truncate text-[12.5px] font-medium">
                {countryName(r.country)}
              </span>
              <span className="text-[12px] font-medium tabular-nums">
                {r.views.toLocaleString()}
              </span>
              <span className="w-9 text-right text-[11px] text-muted-foreground/80 tabular-nums">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
