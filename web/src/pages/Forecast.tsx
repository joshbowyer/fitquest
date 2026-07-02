import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { classNames } from '@/lib/format';

type Component = {
  metric: string;
  rawValue: number | null;
  subscore: number | null;
  weight: number;
  contribution: number;
  reason: string;
  available: boolean;
};
type Readiness = {
  score: number | null;
  trend: number | null;
  components: Component[];
  dataPoints: number;
  totalMetrics: number;
  date: string;
};
type PartRecovery = { bodyPart: string; score: number; lastWorkedAt: string | null };
type Recommendation = PartRecovery;
type ActivityRating = {
  verdict: 'ok' | 'caution' | 'skip';
  reason: string;
};
type DayInsight = {
  verdict: 'go' | 'caution' | 'skip';
  headline: string;
  bestWindow: {
    startHour: number;
    endHour: number;
    apparentTempF: number;
    precipProbability: number;
    windGustMph: number;
    label: string;
  } | null;
  peakHeat: { hour: number; apparentTempF: number; label: string } | null;
  uvPeak: number;
  activityAdvice: { rings: ActivityRating; running: ActivityRating; walking: ActivityRating };
};
type DailyWeather = {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipSum: number;
  precipProbabilityMax: number;
  windMax: number;
  ok: boolean;
  reason: string;
  label: string;
  icon: string;
  insight: DayInsight;
};
type CurrentWeather = {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windGusts: number;
  precipitation: number;
  weatherCode: number;
  isDay: boolean;
  time: string;
  label: string;
  icon: string;
};
type AirQualityCurrent = {
  usAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  band: 'good' | 'moderate' | 'unhealthySensitive' | 'unhealthy' | 'veryUnhealthy' | 'hazardous' | 'unknown';
  bandMeta: { label: string; short: string; tone: 'lime' | 'cyan' | 'amber' | 'magenta'; advice: string };
  time: string;
};
type AirQualityDay = {
  date: string;
  pm25Max: number | null;
  pm10Max: number | null;
  usAqiMax: number | null;
  band: AirQualityCurrent['band'];
  bandMeta: AirQualityCurrent['bandMeta'];
};
type AirQuality = {
  latitude: number;
  longitude: number;
  timezone: string;
  current: AirQualityCurrent;
  daily: AirQualityDay[];
  cached: boolean;
  fetchedAt: string;
};
type ForecastResponse = {
  location?: { latitude: number; longitude: number; source: 'user' | 'workout' };
  weather?: {
    latitude: number;
    longitude: number;
    timezone: string;
    units: { temperature: 'fahrenheit'; windSpeed: 'mph' };
    current: CurrentWeather;
    daily: DailyWeather[];
    fetchedAt: string;
    cached: boolean;
  } | null;
  weatherStatus?: 'cached' | 'fresh' | 'unavailable';
  airQuality?: AirQuality | null;
  airQualityStatus?: 'cached' | 'fresh' | 'unavailable';
  readiness: Readiness;
  recommendation: Recommendation | null;
  recoveryByPart: PartRecovery[];
  needsLocation?: boolean;
  message?: string;
};

// Map API BodyPart values + the synthetic region labels our
// recommendMuscle helper emits (push/pull/legs/cardio/etc.) to
// short display names. Anything not in the map falls back to a
// titlecased version of the raw string.
const PART_LABELS: Record<string, string> = {
  // High-level region labels (recommendMuscle output)
  push: 'Push (chest/shoulder/tri)',
  pull: 'Pull (back/biceps)',
  legs: 'Legs',
  cardio: 'Cardio',
  core: 'Core',
  mobility: 'Mobility',
  // Granular BodyPart enum
  CHEST: 'Chest',
  BACK_UPPER: 'Upper back',
  BACK_LOWER: 'Lower back',
  PECTORAL: 'Pectorals',
  ABS: 'Abs',
  QUAD_L: 'Quads',
  QUAD_R: 'Quads',
  HAMSTRING_L: 'Hamstrings',
  HAMSTRING_R: 'Hamstrings',
  GLUTE_L: 'Glutes',
  GLUTE_R: 'Glutes',
  CALF_L: 'Calves',
  CALF_R: 'Calves',
  SHOULDER_L: 'Shoulders',
  SHOULDER_R: 'Shoulders',
  BICEP_L: 'Biceps',
  BICEP_R: 'Biceps',
  TRICEP_L: 'Triceps',
  TRICEP_R: 'Triceps',
  LAT_L: 'Lats',
  LAT_R: 'Lats',
};
function partLabel(p: string): string {
  if (PART_LABELS[p]) return PART_LABELS[p];
  // Titlecase + underscores → spaces as a last-ditch fallback
  return p.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const METRIC_LABELS: Record<string, string> = {
  HRV: 'HRV',
  SLEEP_HOURS: 'Sleep',
  RESTING_HR: 'Resting HR',
  SLEEP_QUALITY: 'Sleep Q',
  SORENESS: 'Soreness',
  STRESS: 'Stress',
  ENERGY: 'Energy',
  MOOD: 'Mood',
};

function scoreColor(score: number | null): 'lime' | 'cyan' | 'amber' | 'magenta' {
  if (score == null) return 'cyan';
  if (score >= 80) return 'lime';
  if (score >= 60) return 'cyan';
  if (score >= 40) return 'amber';
  return 'magenta';
}
function scoreLabel(score: number | null): string {
  if (score == null) return 'NO DATA';
  if (score >= 80) return 'PRIMED';
  if (score >= 60) return 'READY';
  if (score >= 40) return 'CAUTION';
  return 'DEPLETED';
}

function dayLabel(iso: string, index: number): string {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  // For day 2, show weekday name
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function WeatherCard({ data }: { data: NonNullable<ForecastResponse['weather']> }) {
  const c = data.current;
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-5xl">{c.icon}</div>
      <div>
        <div
          className="font-display text-4xl neon-text-cyan leading-none"
          style={{ textShadow: '0 0 12px currentColor' }}
        >
          {c.temperature.toFixed(0)}°
        </div>
        <div className="text-[10px] font-display tracking-widest uppercase text-ink-100 mt-1">
          {c.label} · feels {c.apparentTemperature.toFixed(0)}°
        </div>
        <div className="text-[10px] font-mono text-ink-300 mt-0.5">
          wind {c.windSpeed.toFixed(0)}mph · {c.humidity.toFixed(0)}% rh
          {c.precipitation > 0 && ` · ${c.precipitation.toFixed(1)}mm`}
        </div>
      </div>
    </div>
  );
}

// Tone color for the verdict. "go" = lime, "caution" = amber,
// "skip" = magenta. Mirrors the AQI band palette.
function verdictTone(v: 'go' | 'caution' | 'skip'): 'lime' | 'amber' | 'magenta' {
  if (v === 'go') return 'lime';
  if (v === 'caution') return 'amber';
  return 'magenta';
}
function verdictGlyph(v: 'go' | 'caution' | 'skip'): string {
  if (v === 'go') return '✓';
  if (v === 'caution') return '!';
  return '✗';
}
function activityGlyph(v: 'ok' | 'caution' | 'skip'): string {
  if (v === 'ok') return '✓';
  if (v === 'caution') return '!';
  return '✗';
}
function activityTone(v: 'ok' | 'caution' | 'skip'): 'lime' | 'amber' | 'magenta' {
  if (v === 'ok') return 'lime';
  if (v === 'caution') return 'amber';
  return 'magenta';
}

function DayCard({ day, idx }: { day: DailyWeather; idx: number }) {
  const ins = day.insight;
  const tone = verdictTone(ins.verdict);
  return (
    <div className={classNames(
      'p-3 border rounded-sm space-y-2',
      `border-neon-${tone}/30`,
    )}>
      {/* Day label + weather glyph */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-display tracking-widest uppercase text-ink-100">
          {dayLabel(day.date, idx)}
        </div>
        <div className="text-xl">{day.icon}</div>
      </div>
      {/* Hi/lo */}
      <div className="font-mono text-lg">
        <span className="neon-text-lime">{day.tempMax.toFixed(0)}°</span>
        <span className="text-ink-400"> / </span>
        <span className="text-ink-300">{day.tempMin.toFixed(0)}°</span>
      </div>
      {/* One-line verdict + headline */}
      <div className={`text-[10px] font-mono neon-text-${tone}`}>
        <span className="mr-1">{verdictGlyph(ins.verdict)}</span>
        {ins.headline}
      </div>
      {/* Best 2-hour window — the actionable line. */}
      {ins.bestWindow && (
        <div className="text-[10px] font-mono text-ink-200 border-t border-current/10 pt-1.5">
          <span className="text-ink-400">Best window: </span>
          <span className="neon-text-cyan">{ins.bestWindow.label}</span>
          {ins.bestWindow.precipProbability > 20 && (
            <span className="text-ink-400"> · {ins.bestWindow.precipProbability.toFixed(0)}% rain</span>
          )}
          {ins.bestWindow.windGustMph > 15 && (
            <span className="text-ink-400"> · gusts {ins.bestWindow.windGustMph.toFixed(0)}mph</span>
          )}
        </div>
      )}
      {/* Peak heat — show only if it materially exceeds the
          best window. Skips the line when the peak isn't much
          hotter than the morning window. */}
      {ins.peakHeat && ins.bestWindow &&
        ins.peakHeat.apparentTempF - ins.bestWindow.apparentTempF > 8 && (
        <div className="text-[10px] font-mono text-ink-400">
          {ins.peakHeat.label}
        </div>
      )}
      {/* Per-activity advice — three mini-rows. Hidden if all
          three are 'ok' and the headline already covers it (avoids
          redundant lines on perfect days). */}
      {!(ins.activityAdvice.rings.verdict === 'ok' &&
        ins.activityAdvice.running.verdict === 'ok' &&
        ins.activityAdvice.walking.verdict === 'ok') && (
        <div className="text-[10px] font-mono space-y-0.5 border-t border-current/10 pt-1.5">
          {(['rings', 'running', 'walking'] as const).map((k) => {
            const a = ins.activityAdvice[k];
            return (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-ink-300 capitalize">{k}</span>
                <span className={`neon-text-${activityTone(a.verdict)}`}>
                  {activityGlyph(a.verdict)} {a.reason}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* UV peak — only when high enough to matter. */}
      {ins.uvPeak >= 6 && (
        <div className="text-[10px] font-mono text-amber-300/80">
          UV peak {ins.uvPeak.toFixed(1)} — sunscreen.
        </div>
      )}
      {/* Compact fallback (no hourly window) — show the basic
          rain/wind numbers so the card isn't empty. */}
      {!ins.bestWindow && (day.precipProbabilityMax > 0 || day.windMax > 0) && (
        <div className="text-[10px] font-mono text-ink-400 border-t border-current/10 pt-1.5">
          {day.precipProbabilityMax > 0 && `${day.precipProbabilityMax.toFixed(0)}% rain`}
          {day.precipProbabilityMax > 0 && day.windMax > 0 && ' · '}
          {day.windMax > 0 && `wind ${day.windMax.toFixed(0)}mph`}
        </div>
      )}
    </div>
  );
}

export function ForecastPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['forecast'],
    queryFn: () => api<ForecastResponse>('/forecast'),
    staleTime: 5 * 60 * 1000, // 5 min client cache; server caches 1h
  });

  // Invalidate forecast when the user updates their location so
  // the next visit re-fetches.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['forecast'] });

  const data = q.data;
  const readiness = data?.readiness;
  const score = readiness?.score ?? null;
  const color = scoreColor(score);
  const recommendation = data?.recommendation ?? null;
  const recColor = recommendation ? scoreColor(recommendation.score) : 'cyan';
  const weather = data?.weather ?? null;
  const hasLocation = data?.location != null;

  return (
    <Layout>
      <PageHeader
        title="Forecast"
        subtitle="Outdoor conditions + today's readiness, in one glance."
        action={
          <button
            onClick={() => q.refetch()}
            className="text-[10px] font-mono uppercase tracking-widest text-ink-300 hover:text-neon-cyan border border-ink-500/30 px-2 py-1"
            disabled={q.isFetching}
          >
            {q.isFetching ? '…' : '↻ refresh'}
          </button>
        }
      />

      {/* Empty state: no location yet */}
      {data?.needsLocation && !hasLocation && (
        <Panel variant="amber" title="Set your home location" scanline>
          <div className="space-y-3">
            <div className="text-sm text-ink-100">
              Go to{' '}
              <Link to="/profile" className="neon-text-cyan underline">
                Profile
              </Link>{' '}
              to set your home location — search by city or zip, paste lat/lng, or use your device's location.
            </div>
            <div className="text-[10px] text-ink-400 font-mono">
              Alternatively, log any outdoor workout (run/walk/bike) and its GPS centroid will be used as a fallback.
            </div>
          </div>
        </Panel>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        {/* Weather card */}
        <Panel variant="cyan" title="Weather" scanline>
          {!hasLocation && (
            <div className="text-sm text-ink-300">Awaiting location — set it on Profile to enable.</div>
          )}
          {hasLocation && q.isLoading && (
            <div className="text-sm text-ink-300 animate-pulse">Fetching forecast…</div>
          )}
          {hasLocation && data?.weatherStatus === 'unavailable' && !q.isLoading && (
            <div className="space-y-2">
              <div className="text-sm text-ink-100">Weather unavailable.</div>
              <div className="text-xs text-ink-300">
                Open-Meteo didn't respond. Check connectivity + try refreshing. The readiness
                card below is unaffected.
              </div>
            </div>
          )}
          {weather && (
            <div className="space-y-4">
              <WeatherCard data={weather} />
              <div className="grid grid-cols-3 gap-2">
                {weather.daily.map((d, i) => (
                  <DayCard key={d.date} day={d} idx={i} />
                ))}
              </div>
              <div className="text-[10px] font-mono text-ink-400 pt-2 border-t border-current/10">
                {data?.weatherStatus === 'cached' ? 'cached' : 'fresh'} ·{' '}
                {data?.location?.source === 'workout' ? 'from last workout GPS' : 'home location'}
                {' · '}
                <Link to="/profile" className="neon-text-cyan underline" onClick={invalidate}>
                  change
                </Link>
              </div>
            </div>
          )}
        </Panel>

        {/* Readiness card */}
        <Panel variant={color} title="Readiness" scanline>
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <div
                  className={classNames('font-display text-5xl leading-none', `neon-text-${color}`)}
                  style={score != null ? { textShadow: '0 0 12px currentColor, 0 0 24px currentColor' } : undefined}
                >
                  {score ?? '—'}
                </div>
                <div className={classNames('text-[10px] font-display tracking-widest mt-1', `neon-text-${color}`)}>
                  {scoreLabel(score)}
                </div>
              </div>
              {readiness?.trend != null && (
                <div className="text-right">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">7-day avg</div>
                  <div className="font-mono text-lg text-ink-100">{readiness.trend}</div>
                </div>
              )}
            </div>

            <div className="text-[10px] font-mono text-ink-300">
              based on {readiness?.dataPoints ?? 0}/{readiness?.totalMetrics ?? 8} metrics
            </div>

            <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
              {(readiness?.components ?? []).map((c) => (
                <div key={c.metric} className="flex justify-between">
                  <span className={c.available ? 'text-ink-200' : 'text-ink-400'}>
                    {METRIC_LABELS[c.metric] || c.metric}
                  </span>
                  <span className={c.available ? 'text-ink-100' : 'text-ink-400'}>
                    {c.available && c.subscore != null ? c.subscore : '—'}
                  </span>
                </div>
              ))}
            </div>

            {/* Recommendation */}
            {recommendation && (
              <div className="pt-3 mt-1 border-t border-current/10">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                  Suggestion
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={classNames('font-display text-lg neon-text-' + recColor)}
                    style={{ textShadow: '0 0 8px currentColor' }}
                  >
                    {partLabel(recommendation.bodyPart)}
                  </div>
                  <div className={classNames('text-[10px] font-mono neon-text-' + recColor)}>
                    {recommendation.score}/100
                  </div>
                </div>
                <div className="text-[10px] font-mono text-ink-300 mt-1">
                  Highest recovery score; hasn't been worked in {hoursAgo(recommendation.lastWorkedAt)}.
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {user?.latitude == null && user?.longitude == null && data?.location?.source === 'workout' && (
        <div className="text-[10px] font-mono text-ink-400 mt-3 px-1">
          Using GPS from your most-recent outdoor workout. For a stable home forecast, set
          explicit lat/lng on <Link to="/profile" className="neon-text-cyan underline">Profile</Link>.
        </div>
      )}

      {/* Air quality — third card, separate row so the page
          stays scannable. Hidden when location is missing or
          AQ upstream is unavailable. */}
      {hasLocation && data?.airQuality && (
        <div className="mt-4">
          <AirQualityCard data={data.airQuality} />
        </div>
      )}
      {hasLocation && data?.weatherStatus !== 'unavailable' && data?.airQualityStatus === 'unavailable' && (
        <div className="text-[10px] font-mono text-ink-400 mt-3 px-1">
          Air quality data unavailable (Open-Meteo air-quality endpoint didn't respond).
        </div>
      )}
    </Layout>
  );
}

function AirQualityCard({ data }: { data: NonNullable<ForecastResponse['airQuality']> }) {
  const c = data.current;
  const tone = c.bandMeta.tone;
  return (
    <Panel variant={tone} title="Air quality" scanline>
      <div className="grid lg:grid-cols-[auto_1fr] gap-4 items-start">
        {/* Headline: AQI number + band */}
        <div className="flex items-baseline gap-3">
          <div
            className={`font-display text-5xl neon-text-${tone} leading-none`}
            style={{ textShadow: '0 0 12px currentColor' }}
          >
            {c.usAqi ?? '—'}
          </div>
          <div>
            <div className={`text-[10px] font-display tracking-widest uppercase neon-text-${tone}`}>
              {c.bandMeta.short} {c.bandMeta.label}
            </div>
            <div className="text-[10px] font-mono text-ink-300 mt-1">
              {c.pm25 != null && <>PM2.5 {c.pm25.toFixed(1)} µg/m³</>}
              {c.pm25 != null && c.pm10 != null && ' · '}
              {c.pm10 != null && <>PM10 {c.pm10.toFixed(1)} µg/m³</>}
            </div>
          </div>
        </div>
        {/* Advice + 3-day trend */}
        <div className="space-y-2">
          <div className={`text-xs font-mono neon-text-${tone}`}>
            {c.bandMeta.advice}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {data.daily.map((d, i) => (
              <div
                key={d.date}
                className={`p-2 border rounded-sm space-y-1 border-neon-${d.bandMeta.tone}/30`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-display tracking-widest uppercase text-ink-100">
                    {dayLabel(d.date, i)}
                  </div>
                  <div className={`text-[10px] font-mono neon-text-${d.bandMeta.tone}`}>
                    {d.usAqiMax != null ? d.usAqiMax : '—'}
                  </div>
                </div>
                <div className="text-[10px] font-mono text-ink-400">
                  {d.pm25Max != null && <>PM2.5 {d.pm25Max.toFixed(0)}</>}
                  {d.pm25Max != null && d.pm10Max != null && ' · '}
                  {d.pm10Max != null && <>PM10 {d.pm10Max.toFixed(0)}</>}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] font-mono text-ink-400 pt-1 border-t border-current/10">
            {data.cached ? 'cached' : 'fresh'} · US EPA AQI scale
          </div>
        </div>
      </div>
    </Panel>
  );
}

function hoursAgo(iso: string | null): string {
  if (!iso) return 'a while';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.round(ms / (60 * 60 * 1000));
  if (h < 1) return 'less than an hour';
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}