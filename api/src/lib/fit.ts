import { Decoder, Stream } from '@garmin/fitsdk';
import type {
  SessionMesg,
  SleepAssessmentMesg,
  HrvStatusSummaryMesg,
  HrvValueMesg,
  MonitoringMesg,
  StressLevelMesg,
  RespirationRateMesg,
} from '@garmin/fitsdk';

/**
 * FIT file import — dispatches by `file_id.type` to the right parser
 * and produces a uniform `FitImportResult` that the API maps onto
 * Prisma rows (Workout / Measurement / DailyLog).
 *
 * Designed so the same code path can be reused by the future
 * Gadgetbridge integration: the PR (codeberg PR #5809) pushes
 * `.fit` files into subdirectories by type. Whether the upload
 * arrives via web form, a directory poll, or a webhook from a
 * forked Gadgetbridge, it ends up here.
 */

export type FitKind = 'activity' | 'sleep' | 'hrv' | 'monitor' | 'metrics' | 'unknown';

export type FitImportResult = {
  kind: FitKind;
  /** ISO timestamp the file_id.time_created reports. */
  sourceTimestamp: string | null;
  workouts?: ParsedActivity[];
  measurements?: ParsedMeasurement[];
  skipped?: { reason: string }[];
};

export type ParsedActivity = {
  startTime: Date;
  durationSec: number;
  sport: string;
  subSport?: string;
  distanceMeters?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  totalCalories?: number;
  totalAscent?: number;
  totalDescent?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  avgSpeedMps?: number;
  maxSpeedMps?: number;
  rpe?: number;
};

export type ParsedMeasurement = {
  metric:
    | 'SLEEP_HOURS'
    | 'SLEEP_QUALITY'
    | 'HRV'
    | 'RESTING_HR'
    | 'STRESS'
    | 'RESPIRATION_RATE'
    | 'VO2_MAX';
  value: number;
  recordedAt: Date;
  notes?: string;
};

const FIT_KIND_LABELS: Record<number | string, FitKind> = {
  4: 'activity',       // activity files
  activity: 'activity',
  49: 'sleep',
  68: 'hrv',
  monitoring_b: 'monitor',
  monitoringB: 'monitor',
  44: 'metrics',
  12: 'activity', // 12 = activity_summary (workouts merged across devices)
};

export function detectFitKind(typeValue: unknown): FitKind {
  if (typeof typeValue === 'number') return FIT_KIND_LABELS[typeValue] ?? 'unknown';
  if (typeof typeValue === 'string') return FIT_KIND_LABELS[typeValue] ?? 'unknown';
  return 'unknown';
}

export function parseFit(buf: Buffer): FitImportResult {
  let decoded: { messages: any; errors: any[] };
  try {
    const stream = Stream.fromBuffer(buf);
    decoded = new Decoder(stream).read();
  } catch (e: any) {
    return {
      kind: 'unknown',
      sourceTimestamp: null,
      skipped: [{ reason: `FIT decode failed: ${e?.message ?? 'unknown error'}` }],
    };
  }

  const fileId = decoded.messages.fileIdMesgs?.[0];
  const kind = detectFitKind(fileId?.type);
  const sourceTimestamp =
    fileId?.timeCreated instanceof Date
      ? fileId.timeCreated.toISOString()
      : typeof fileId?.timeCreated === 'string'
      ? fileId.timeCreated
      : null;

  const skipped: { reason: string }[] = [];
  if (decoded.errors && decoded.errors.length > 0) {
    skipped.push({
      reason: `Decoder reported ${decoded.errors.length} soft errors (file still parsed).`,
    });
  }

  switch (kind) {
    case 'activity':
      return { kind, sourceTimestamp, ...parseActivity(decoded.messages), skipped: skipped.length ? skipped : undefined };
    case 'sleep':
      return { kind, sourceTimestamp, ...parseSleep(decoded.messages), skipped: skipped.length ? skipped : undefined };
    case 'hrv':
      return { kind, sourceTimestamp, ...parseHrv(decoded.messages), skipped: skipped.length ? skipped : undefined };
    case 'monitor':
      return { kind, sourceTimestamp, ...parseMonitor(decoded.messages), skipped: skipped.length ? skipped : undefined };
    case 'metrics':
      return {
        kind,
        sourceTimestamp,
        skipped: [
          ...skipped,
          {
            reason:
              'METRICS files are Garmin-specific health snapshots; not imported in v1. Future: body battery, intensity minutes, steps.',
          },
        ],
      };
    default:
      return {
        kind: 'unknown',
        sourceTimestamp,
        skipped: [
          ...skipped,
          {
            reason: `Unrecognized FIT file_id.type: ${String(fileId?.type)}. Skipped.`,
          },
        ],
      };
  }
}

// ============================================================
// Activity parser
// ============================================================

function parseActivity(messages: any): Pick<FitImportResult, 'workouts'> {
  const sessions = (messages.sessionMesgs ?? []) as SessionMesg[];
  if (sessions.length === 0) return {};

  return {
    workouts: sessions
      .filter((s) => typeof s.startTime === 'string' || s.startTime instanceof Date)
      .map((s) => ({
        startTime: s.startTime instanceof Date ? s.startTime : new Date(s.startTime as string),
        durationSec: Math.round(s.totalTimerTime ?? 0),
        sport: sportName(s.sport),
        subSport: subSportName(s.subSport),
        distanceMeters: s.totalDistance,
        avgHeartRate: s.avgHeartRate,
        maxHeartRate: s.maxHeartRate,
        totalCalories: s.totalCalories,
        totalAscent: s.totalAscent,
        totalDescent: s.totalDescent,
        avgPower: s.avgPower,
        maxPower: s.maxPower,
        normalizedPower: s.normalizedPower,
        avgSpeedMps: s.enhancedAvgSpeed ?? s.avgSpeed,
        maxSpeedMps: s.enhancedMaxSpeed ?? s.maxSpeed,
        rpe: s.workoutRpe,
      })),
  };
}

// FIT Sport enum -> human name. From FIT Global Profile v21.x.
// Sport is a string literal union ("running" | "cycling" | ...) — see
// @garmin/fitsdk Types.Sport. We pass it through as-is when it's a
// known label, otherwise stringify it.
function sportName(sport: unknown): string {
  if (sport == null) return 'unknown';
  if (typeof sport === 'string') return sport;
  // Numbers are valid in older FIT profiles; map legacy codes to names.
  switch (sport as number) {
    case 0: return 'generic';
    case 1: return 'running';
    case 2: return 'cycling';
    case 3: return 'transition';
    case 4: return 'fitness_equipment';
    case 5: return 'swimming';
    case 6: return 'basketball';
    case 7: return 'soccer';
    case 8: return 'tennis';
    case 9: return 'american_football';
    case 10: return 'training';
    case 11: return 'walking';
    case 12: return 'cross_country_skiing';
    case 13: return 'alpine_skiing';
    case 14: return 'snowboarding';
    case 15: return 'rowing';
    case 16: return 'mountaineering';
    case 17: return 'hiking';
    case 18: return 'multisport';
    case 19: return 'paddling';
    case 20: return 'flying';
    case 21: return 'e_biking';
    case 22: return 'motorcycling';
    case 23: return 'boating';
    case 24: return 'driving';
    case 25: return 'golf';
    case 26: return 'hang_gliding';
    case 27: return 'horseback_riding';
    case 28: return 'hunting';
    case 29: return 'fishing';
    case 30: return 'inline_skating';
    case 31: return 'rock_climbing';
    case 32: return 'sailing';
    case 33: return 'ice_skating';
    case 34: return 'sky_diving';
    case 35: return 'snowshoeing';
    case 36: return 'snowmobiling';
    case 37: return 'stand_up_paddleboarding';
    case 38: return 'surfing';
    case 39: return 'wakeboarding';
    case 40: return 'water_skiing';
    case 41: return 'kayaking';
    case 42: return 'rafting';
    case 43: return 'windsurfing';
    case 44: return 'kitesurfing';
    case 45: return 'tactical';
    case 46: return 'jumpmaster';
    case 47: return 'boxing';
    case 48: return 'floor_climbing';
    case 53: return 'diving';
    case 254: return 'all';
    default: return `sport_${sport}`;
  }
}

function subSportName(sub: unknown): string | undefined {
  if (sub == null) return undefined;
  if (typeof sub === 'string') return sub;
  // Legacy numeric sub-sport mapping; full list is in FIT profile.
  const map: Record<number, string> = {
    0: 'generic', 1: 'treadmill', 2: 'street', 3: 'trail',
    4: 'track', 5: 'spin', 6: 'indoor_cycling', 7: 'road',
    8: 'mountain', 9: 'downhill', 10: 'recumbent',
    11: 'cyclocross', 13: 'all_terrain', 14: 'gravel',
    15: 'commuting', 16: 'mixed_surface', 17: 'virtual_activity',
    22: 'lap_swimming', 23: 'open_water',
  };
  return map[sub as number] ?? `subsport_${sub}`;
}

// ============================================================
// Sleep parser
// ============================================================

function parseSleep(messages: any): Pick<FitImportResult, 'measurements'> {
  const events = (messages.eventMesgs ?? []) as any[];
  const assessments = (messages.sleepAssessmentMesgs ?? []) as SleepAssessmentMesg[];

  // Find start/stop events for sleep. event=74 is "sleep" in FIT profile.
  const starts = events.filter((e) => e.event === 74 && e.eventType === 'start');
  const stops = events.filter((e) => e.event === 74 && e.eventType === 'stop');
  const startTime = starts[0]?.timestamp;
  const stopTime = stops[stops.length - 1]?.timestamp;
  const recordedAt =
    (stopTime instanceof Date ? stopTime : startTime ? new Date(startTime) : null) ??
    new Date();

  const measurements: ParsedMeasurement[] = [];

  // Sleep hours: compute from start/stop
  if (startTime && stopTime) {
    const ms = new Date(stopTime).getTime() - new Date(startTime).getTime();
    const hours = ms / (1000 * 60 * 60);
    if (hours > 0 && hours < 24) {
      measurements.push({
        metric: 'SLEEP_HOURS',
        value: Math.round(hours * 10) / 10,
        recordedAt,
      });
    }
  }

  // Sleep quality: overallSleepScore (0-100) → map to 1-10 scale
  const assessment = assessments[0];
  if (assessment) {
    const score = assessment.overallSleepScore;
    if (typeof score === 'number') {
      const quality10 = Math.max(1, Math.min(10, Math.round(score / 10)));
      measurements.push({
        metric: 'SLEEP_QUALITY',
        value: quality10,
        recordedAt,
        notes: `FIT overallSleepScore=${score}/100`,
      });
    }
  }

  if (measurements.length === 0) {
    return {};
  }
  return { measurements };
}

// ============================================================
// HRV parser
// ============================================================

function parseHrv(messages: any): Pick<FitImportResult, 'measurements'> {
  const summary = (messages.hrvStatusSummaryMesgs ?? []) as HrvStatusSummaryMesg[];
  const values = (messages.hrvValueMesgs ?? []) as HrvValueMesg[];
  const measurements: ParsedMeasurement[] = [];

  const recordedAt = (() => {
    if (summary[0]?.timestamp) return toDate(summary[0].timestamp);
    if (values[values.length - 1]?.timestamp) return toDate(values[values.length - 1]!.timestamp);
    return new Date();
  })();

  // Prefer weeklyAverage from the status summary (Garmin computes this
  // overnight), fall back to lastNightAverage, then to the mean of the
  // hrv_value stream.
  const candidate =
    summary[0]?.weeklyAverage ??
    summary[0]?.lastNightAverage ??
    (values.length > 0
      ? Math.round(values.reduce((s, v) => s + (v.value ?? 0), 0) / values.length)
      : null);
  if (candidate != null && candidate > 0) {
    measurements.push({
      metric: 'HRV',
      value: Math.round(candidate),
      recordedAt,
      notes:
        summary[0]?.weeklyAverage != null
          ? `FIT weeklyAverage=${summary[0].weeklyAverage}ms`
          : summary[0]?.lastNightAverage != null
          ? `FIT lastNightAverage=${summary[0].lastNightAverage}ms`
          : `FIT mean of ${values.length} 5-min samples`,
    });
  }

  return measurements.length ? { measurements } : {};
}

// ============================================================
// Monitor parser (avg stress, respiration) — best-effort
// ============================================================

function parseMonitor(messages: any): Pick<FitImportResult, 'measurements'> {
  const stress = (messages.stressLevelMesgs ?? []) as StressLevelMesg[];
  const resp = (messages.respirationRateMesgs ?? []) as RespirationRateMesg[];
  const monitoring = (messages.monitoringMesgs ?? []) as MonitoringMesg[];
  const measurements: ParsedMeasurement[] = [];

  // Average stress: average across the file's window
  if (stress.length > 0) {
    // Garmin stores stress as an array of int8 values in stressLevelValue;
    // the SDK exposes it as `stressLevelValue`. We average those > 0
    // (Garmin uses 0 for "no reading").
    const values: number[] = [];
    for (const s of stress) {
      const arr = s.stressLevelValue;
      if (Array.isArray(arr)) {
        for (const v of arr) if (typeof v === 'number' && v > 0) values.push(v);
      }
    }
    if (values.length > 0) {
      const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
      const recordedAt = new Date();
      measurements.push({ metric: 'STRESS', value: avg, recordedAt });
    }
  }

  // Average respiration rate (breaths per minute)
  if (resp.length > 0) {
    const values = resp
      .map((r) => (r as any).respirationRate ?? (r as any).enhancedRespirationRate ?? 0)
      .filter((v: number) => v > 0);
    if (values.length > 0) {
      const avg = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
      void avg;
      // We don't have a RESPIRATION_RATE metric in METRICS yet, so skip
      // silently. Future: add it.
    }
  }

  void monitoring;
  return measurements.length ? { measurements } : {};
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return new Date();
}

// ============================================================
// Validation helpers (header sniff)
// ============================================================

/**
 * Cheap pre-flight check: a FIT file's header is either 12 or 14 bytes
 * and contains ".FIT" at bytes 8..11 (for 14-byte headers) or has the
 * CRC flag at byte 12. We do a minimum sanity check on the header
 * size, then let `parseFit` do the real validation via the SDK.
 */
export function isFitBuffer(buf: Buffer): boolean {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  const headerSize = buf[0];
  if (headerSize !== 12 && headerSize !== 14) return false;
  if (headerSize === 14 && buf.length >= 12) {
    // Bytes 8..11 are the ASCII signature ".FIT" for 14-byte headers.
    const sig = buf.slice(8, 12).toString('ascii');
    if (sig !== '.FIT') return false;
  }
  return true;
}