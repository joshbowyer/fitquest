import { computeRecovery, type RecoveryScore, type RecoveryComponent } from './recovery.js';
import { computeCorrelations, type Correlation } from './correlations.js';
import { prisma } from './prisma.js';

export type Insight = {
  type:
    | 'recovery_low'
    | 'recovery_high'
    | 'recovery_drag'
    | 'strong_corr'
    | 'coverage_gap'
    | 'streak_at_risk'
    | 'no_data';
  severity: 'info' | 'positive' | 'warning';
  icon: string;
  title: string;
  message: string;
  metric?: string;
  value?: number;
};

function daysSince(userId: string, metric: string): Promise<number | null> {
  return (async () => {
    const last = await prisma.measurement.findFirst({
      where: { userId, metric: metric as any },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    if (!last) return null;
    return Math.floor((Date.now() - last.recordedAt.getTime()) / (24 * 60 * 60 * 1000));
  })();
}

function habitName(metric: string): string {
  const map: Record<string, string> = {
    SLEEP_HOURS: 'sleep hours',
    SLEEP_QUALITY: 'sleep quality',
    HRV: 'HRV',
    RESTING_HR: 'resting HR',
    ENERGY: 'energy',
    MOOD: 'mood',
    SORENESS: 'soreness',
    STRESS: 'stress',
    CALORIES: 'calories',
    PROTEIN_G: 'protein',
    WATER_ML: 'water intake',
  };
  return map[metric] ?? metric;
}

function correlateSentence(c: Correlation): string {
  const dir = c.r > 0 ? 'boost' : 'drain';
  const strength =
    Math.abs(c.r) >= 0.7 ? 'strongly' : Math.abs(c.r) >= 0.4 ? 'moderately' : 'slightly';
  return `${c.habitLabel} ${strength} ${dir}s your ${c.outcomeLabel.toLowerCase()} (r=${c.r.toFixed(2)}, n=${c.n}).`;
}

export async function generateInsights(userId: string): Promise<Insight[]> {
  const tips: Insight[] = [];

  // ---- Recovery insights ----
  const recovery = await computeRecovery(userId);
  if (recovery.score != null) {
    if (recovery.score < 50) {
      tips.push({
        type: 'recovery_low',
        severity: 'warning',
        icon: '⚠',
        title: 'Low recovery',
        message: `Your recovery is ${recovery.score}/100. Consider dialing back intensity today.`,
      });
    } else if (recovery.score >= 80) {
      tips.push({
        type: 'recovery_high',
        severity: 'positive',
        icon: '✓',
        title: 'Primed',
        message: `Your recovery is ${recovery.score}/100. Great day to push for a PR.`,
      });
    }
    // Identify the largest drag
    const available = recovery.components.filter((c) => c.available && c.subscore != null);
    if (available.length >= 2) {
      const worst = available.reduce<RecoveryComponent>(
        (min, c) => ((c.subscore ?? 0) < (min.subscore ?? 0) ? c : min),
        available[0]!
      );
      const best = available.reduce<RecoveryComponent>(
        (max, c) => ((c.subscore ?? 0) > (max.subscore ?? 0) ? c : max),
        available[0]!
      );
      if ((worst.subscore ?? 0) < 50 && (best.subscore ?? 0) - (worst.subscore ?? 0) > 25) {
        tips.push({
          type: 'recovery_drag',
          severity: 'info',
          icon: '↓',
          title: 'Main drag',
          message: `${habitName(worst.metric).replace(/^./, (s) => s.toUpperCase())} is the biggest drag (${worst.subscore}/100). ${worst.reason}.`,
          metric: worst.metric,
          value: worst.subscore ?? undefined,
        });
      }
    }
  }

  // ---- Correlation insights ----
  const correlations = await computeCorrelations(userId, { topN: 6 });
  if (correlations.length === 0) {
    if (recovery.dataPoints < 3) {
      tips.push({
        type: 'no_data',
        severity: 'info',
        icon: '○',
        title: 'Not enough data',
        message: 'Log a few days of sleep, mood, or HRV alongside workouts to unlock personalized insights.',
      });
    }
  } else {
    for (const c of correlations.slice(0, 3)) {
      if (Math.abs(c.r) < 0.4) continue; // only meaningful
      const sev = Math.abs(c.r) >= 0.7 ? 'positive' : 'info';
      const icon = c.r > 0 ? '↑' : '↓';
      tips.push({
        type: 'strong_corr',
        severity: sev,
        icon,
        title: `${c.r > 0 ? 'Pattern' : 'Anti-pattern'} found`,
        message: correlateSentence(c),
        metric: c.habit,
        value: c.r,
      });
    }
  }

  // ---- Coverage gaps ----
  for (const m of ['HRV', 'SLEEP_HOURS', 'MOOD']) {
    const days = await daysSince(userId, m);
    if (days != null && days >= 4) {
      tips.push({
        type: 'coverage_gap',
        severity: 'info',
        icon: '○',
        title: 'Logging gap',
        message: `You haven't logged ${habitName(m)} in ${days} days. Closing this gap unlocks correlations.`,
        metric: m,
      });
    }
  }

  return tips.slice(0, 5);
}

export async function getInsightsSummary(userId: string) {
  const recovery = await computeRecovery(userId);
  const correlations = await computeCorrelations(userId, { topN: 10 });
  const insights = await generateInsights(userId);
  return { recovery, correlations, insights };
}
