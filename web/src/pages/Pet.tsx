import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { classNames } from '@/lib/format';

// =============================================================
// Pet API types (mirror of api/src/lib/petStats.ts +
// api/src/routes/pets.ts serializePet). Kept in sync by hand
// until we publish a typed api client.
// =============================================================
type PetStage = 'puppy' | 'adult' | 'adultArmored' | 'injuredArmored';

type Pet = {
  id: string;
  name: string;
  colorVariant: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  isPuppy: boolean;
  isArmored: boolean;
  isFainted: boolean;
  canToggleArmor: boolean;
  canFeed: boolean;
  canVet: boolean;
  stage: PetStage;
  spritePath: string;
  currentHp: number;
  maxHp: number;
  attack: number;
  baseHp: number;
  baseAttack: number;
  breed: {
    id: string;
    slug: string;
    displayName: string;
    species: string;
  };
  lastFedAt: string | null;
  faintedAt: string | null;
  injuredAt: string | null;
  armoredAt: string | null;
  evolvedAt: string | null;
  createdAt: string;
};

const FEED_COOLDOWN_MS = 60 * 60 * 1000;

function cooldownRemainingMs(lastFedAt: string | null): number {
  if (!lastFedAt) return 0;
  const elapsed = Date.now() - new Date(lastFedAt).getTime();
  return Math.max(0, FEED_COOLDOWN_MS - elapsed);
}

function formatCooldown(ms: number): string {
  if (ms <= 0) return 'ready';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m cooldown`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m cooldown`;
}

export function PetPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const petQ = useQuery({
    queryKey: ['pet'],
    queryFn: () => api<Pet>('/pet'),
  });

  const [feedError, setFeedError] = useState<string | null>(null);
  const [armorError, setArmorError] = useState<string | null>(null);
  const [vetError, setVetError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Tick `now` once a minute so the cooldown string refreshes while
  // the user is sitting on the page.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const feedM = useMutation({
    mutationFn: (count: number) =>
      api<Pet>('/pet/feed', { method: 'POST', body: { count } }),
    onSuccess: () => {
      setFeedError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
    onError: (e: Error) => setFeedError(e instanceof ApiError ? e.message : 'Feed failed'),
  });

  const armorM = useMutation({
    mutationFn: () => api<Pet>('/pet/toggle-armor', { method: 'POST' }),
    onSuccess: () => {
      setArmorError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
    },
    onError: (e: Error) =>
      setArmorError(e instanceof ApiError ? e.message : 'Toggle failed'),
  });

  const vetM = useMutation({
    mutationFn: () => api<Pet>('/pet/vet', { method: 'POST' }),
    onSuccess: () => {
      setVetError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
    onError: (e: Error) => setVetError(e instanceof ApiError ? e.message : 'Vet failed'),
  });

  const pet = petQ.data;
  const cooldownMs = useMemo(() => cooldownRemainingMs(pet?.lastFedAt ?? null), [pet?.lastFedAt, now]);

  if (petQ.isLoading) {
    return (
      <Layout>
        <PageHeader title="Pet" subtitle="Loading your companion…" />
      </Layout>
    );
  }

  if (petQ.error) {
    const err = petQ.error;
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 404) {
      // No pet yet — show empty state with link to shop.
      return (
        <Layout>
          <PageHeader title="Pet" subtitle="Your loyal companion" />
          <div className="mx-auto max-w-xl text-center py-16">
            <div className="text-ink-300 mb-6">
              You don't have a pet yet. Visit the shop to adopt your companion.
            </div>
            <Link to="/shop">
              <NeonButton variant="cyan">Visit the Shop</NeonButton>
            </Link>
          </div>
        </Layout>
      );
    }
    return (
      <Layout>
        <PageHeader title="Pet" />
        <Panel variant="magenta" title="Could not load pet">
          <div className="text-ink-300 text-sm">
            {err instanceof ApiError ? err.message : String(err)}
          </div>
        </Panel>
      </Layout>
    );
  }

  if (!pet) return null;

  const xpPct = pet.xp / Math.max(1, pet.xp + pet.xpToNextLevel);
  const hpPct = pet.currentHp / Math.max(1, pet.maxHp);

  return (
    <Layout>
      <PageHeader
        title={pet.name}
        subtitle={
          <>
            Level {pet.level} {pet.breed.displayName} ·{' '}
            <span className="text-ink-300">{pet.colorVariant}</span>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-[260px_1fr] max-w-4xl">
        {/* Sprite */}
        <Panel variant="cyan" title="Sprite" className="flex items-center justify-center p-2">
          <img
            src={pet.spritePath}
            alt={pet.name}
            width={256}
            height={256}
            className={classNames(
              'pixelated w-full max-w-[256px] h-auto',
              pet.isFainted && 'opacity-60 grayscale',
            )}
            style={{ imageRendering: 'pixelated' }}
          />
        </Panel>

        <div className="space-y-4">
          {/* Vitals */}
          <Panel variant="cyan" title="Vitals">
            <div className="space-y-3">
              {/* HP */}
              <div>
                <div className="flex justify-between text-xs font-mono uppercase tracking-widest text-ink-300 mb-1">
                  <span>HP</span>
                  <span>
                    {pet.currentHp} / {pet.maxHp}
                  </span>
                </div>
                <div className="h-3 bg-bg-900 border border-neon-cyan/30 rounded">
                  <div
                    className={classNames(
                      'h-full rounded transition-all',
                      pet.isFainted ? 'bg-neon-magenta' : 'bg-neon-cyan',
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, hpPct * 100))}%` }}
                  />
                </div>
              </div>

              {/* XP */}
              <div>
                <div className="flex justify-between text-xs font-mono uppercase tracking-widest text-ink-300 mb-1">
                  <span>XP</span>
                  <span>
                    {pet.xp} / {pet.xp + pet.xpToNextLevel}
                  </span>
                </div>
                <div className="h-3 bg-bg-900 border border-neon-cyan/30 rounded">
                  <div
                    className="h-full bg-neon-cyan rounded transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, xpPct * 100))}%` }}
                  />
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded border border-neon-cyan/20 p-2 text-center">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Attack</div>
                  <div className="text-2xl font-display text-neon-cyan">{pet.attack}</div>
                </div>
                <div className="rounded border border-neon-cyan/20 p-2 text-center">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Stage</div>
                  <div className="text-sm font-display text-neon-cyan mt-1">
                    {pet.stage}
                  </div>
                </div>
              </div>

              {/* Status flags */}
              {pet.isFainted && (
                <div className="text-xs font-mono uppercase tracking-widest text-neon-magenta border border-neon-magenta/30 rounded p-2 mt-2">
                  ✗ Fainted. Visit the vet to revive.
                </div>
              )}
              {!pet.isFainted && pet.injuredAt && (
                <div className="text-xs font-mono uppercase tracking-widest text-neon-amber border border-neon-amber/30 rounded p-2 mt-2">
                  ⚠ Injured. Heal at the vet to remove the limp pose.
                </div>
              )}
            </div>
          </Panel>

          {/* Actions */}
          <Panel variant="cyan" title="Actions">
            <div className="space-y-3">
              {/* Feed */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
                    Feed · 10g
                    <span className="ml-2 text-ink-400">
                      {pet.canFeed
                        ? cooldownMs > 0
                          ? `(${formatCooldown(cooldownMs)})`
                          : '(ready)'
                        : '(fainted)'}
                    </span>
                  </div>
                  <NeonButton
                    variant="lime"
                    disabled={
                      !pet.canFeed || cooldownMs > 0 || (user?.gold ?? 0) < 10 || feedM.isPending
                    }
                    onClick={() => feedM.mutate(1)}
                  >
                    {feedM.isPending ? 'Feeding…' : 'Feed (+1 XP)'}
                  </NeonButton>
                </div>
                {feedError && <div className="text-xs text-neon-magenta mt-1">{feedError}</div>}
              </div>

              {/* Toggle armor */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
                    Armor · {pet.isArmored ? 'ON' : 'off'}
                    <span className="ml-2 text-ink-400">
                      {pet.canToggleArmor ? '' : pet.isFainted ? '(fainted)' : `(unlocks at Lv 15, you are Lv ${pet.level})`}
                    </span>
                  </div>
                  <NeonButton
                    variant={pet.isArmored ? 'amber' : 'violet'}
                    disabled={!pet.canToggleArmor || armorM.isPending}
                    onClick={() => armorM.mutate()}
                  >
                    {armorM.isPending ? '…' : pet.isArmored ? 'Remove Armor' : 'Equip Armor'}
                  </NeonButton>
                </div>
                {armorError && <div className="text-xs text-neon-magenta mt-1">{armorError}</div>}
              </div>

              {/* Vet */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
                    Vet · {10 + 5 * pet.level}g
                    <span className="ml-2 text-ink-400">
                      {pet.canVet ? '' : '(only when fainted)'}
                    </span>
                  </div>
                  <NeonButton
                    variant="magenta"
                    disabled={!pet.canVet || (user?.gold ?? 0) < 10 + 5 * pet.level || vetM.isPending}
                    onClick={() => vetM.mutate()}
                  >
                    {vetM.isPending ? '…' : 'Revive'}
                  </NeonButton>
                </div>
                {vetError && <div className="text-xs text-neon-magenta mt-1">{vetError}</div>}
              </div>

              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 pt-2 border-t border-neon-cyan/10">
                Tip: pets auto-train with 10% of every workout XP you earn. Workout to grow them.
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </Layout>
  );
}