-- Forecast / weather page support.
--
-- 1. Home location on User: user-set lat/lng used to query
--    Open-Meteo for the /forecast page. Null = use auto-detected
--    fallback (most-recent workout's track centroid) until the
--    user explicitly opts in via Profile.
--
-- 2. WeatherCache table: round3(lat)_round3(lng) -> the API
--    response JSON + fetchedAt. Mirrors the existing GeoCache
--    pattern. Single-user app, so cache hits are the norm and
--    this just keeps us well under Open-Meteo's free-tier
--    10k req/day ceiling (one fresh fetch per location per hour).

ALTER TABLE "User" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "longitude" DOUBLE PRECISION;

CREATE TABLE "WeatherCache" (
    "key"        TEXT        PRIMARY KEY,
    "lat"        DOUBLE PRECISION NOT NULL,
    "lng"        DOUBLE PRECISION NOT NULL,
    "payload"    JSONB       NOT NULL,
    "fetchedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);