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

type ShopItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  cost: number;
  effectKey: string;
  effectDurationSec: number | null;
  owned: number;
};

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
  isCombatEligible: boolean;
  deployed: boolean;
  canDeploy: boolean;
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
  lastFaintProgress: number | null;
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

type PetRoster = {
  pets: Pet[];
  primaryPetId: string | null;
};

const FEED_COOLDOWN_MS = 60 * 60 * 1000;

function cooldownRemainingMs(lastFedAt: string | null): number {
  if (!lastFedAt) return 0;
  const elapsed = Date.now() - new Date(lastFedAt).getTime();
  return Math.max(0, FEED_COOLDOWN_MS - elapsed);
}

function formatCooldown(ms: number): string {
  if (ms <= 0) return '';
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin < 60) return `${totalMin} minute${totalMin === 1 ? '' : 's'}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'}`;
}

// One pet food per species — Premium Kibble (dogs), Rainbow Worms
// (amphibians), etc. The shop page shows them; this page reads the
// list from /shop/items and filters to ones matching the pet's species.
function expectedFoodEffectKey(species: string): string {
  return `pet_food_${species}`;
}

export function PetPage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();

  const rosterQ = useQuery({
    queryKey: ['pet'],
    queryFn: () => api<PetRoster>('/pet'),
  });

  const roster = rosterQ.data;
  const pets = roster?.pets ?? [];

  // Which pet is the user looking at? Defaults to the server's
  // primary (oldest); user can click another pet in the roster to
  // switch the active view.
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const activePetId = selectedPetId ?? roster?.primaryPetId ?? null;
  const pet = useMemo(() => pets.find((p) => p.id === activePetId) ?? null, [pets, activePetId]);

  const itemsQ = useQuery({
    queryKey: ['shop', 'items'],
    queryFn: () => api<{ items: ShopItem[] }>('/shop/items'),
  });

  // Pet foods only, filtered to ones matching this pet's species.
  const petFoods = useMemo(() => {
    if (!pet) return [] as ShopItem[];
    const target = expectedFoodEffectKey(pet.breed.species);
    return (itemsQ.data?.items ?? []).filter((it) => it.effectKey === target);
  }, [itemsQ.data, pet]);

  const [selectedFoodId, setSelectedFoodId] = useState<string | null>(null);

  // Auto-select the first owned food once items load.
  useEffect(() => {
    if (selectedFoodId) return;
    const first = petFoods.find((f) => f.owned > 0);
    if (first) setSelectedFoodId(first.id);
  }, [petFoods, selectedFoodId]);

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
    mutationFn: ({ foodItemId, count, petId }: { foodItemId: string; count: number; petId: string }) =>
      api<Pet>('/pet/feed', { method: 'POST', body: { foodItemId, count, petId } }),
    onSuccess: () => {
      setFeedError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
      qc.invalidateQueries({ queryKey: ['shop', 'items'] });
      refresh();
    },
    onError: (e: Error) => setFeedError(e instanceof ApiError ? e.message : 'Feed failed'),
  });

  const armorM = useMutation({
    mutationFn: (petId: string) =>
      api<Pet>('/pet/toggle-armor', { method: 'POST', body: { petId } }),
    onSuccess: () => {
      setArmorError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
    },
    onError: (e: Error) =>
      setArmorError(e instanceof ApiError ? e.message : 'Toggle failed'),
  });

  const [deployError, setDeployError] = useState<string | null>(null);
  const deployM = useMutation({
    mutationFn: (petId: string) =>
      api<Pet>('/pet/toggle-deploy', { method: 'POST', body: { petId } }),
    onSuccess: () => {
      setDeployError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
    },
    onError: (e: Error) =>
      setDeployError(e instanceof ApiError ? e.message : 'Toggle failed'),
  });

  const vetM = useMutation({
    mutationFn: (petId: string) =>
      api<Pet>('/pet/vet', { method: 'POST', body: { petId } }),
    onSuccess: () => {
      setVetError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
      refresh();
    },
    onError: (e: Error) => setVetError(e instanceof ApiError ? e.message : 'Vet failed'),
  });

  const cooldownMs = useMemo(() => cooldownRemainingMs(pet?.lastFedAt ?? null), [pet?.lastFedAt, now]);
  const selectedFood = petFoods.find((f) => f.id === selectedFoodId) ?? petFoods[0];
  const ownsFood = (selectedFood?.owned ?? 0) > 0;

  if (rosterQ.isLoading) {
    return (
      <Layout>
        <PageHeader title="Pet" subtitle="Loading your companion…" />
      </Layout>
    );
  }

  if (rosterQ.error) {
    const err = rosterQ.error;
    return (
      <Layout>
        <PageHeader title="Pet" />
        <Panel variant="magenta" title="Could not load pets">
          <div className="text-ink-300 text-sm">
            {err instanceof ApiError ? err.message : String(err)}
          </div>
        </Panel>
      </Layout>
    );
  }

  // No pets yet — empty state with link to shop.
  if (pets.length === 0) {
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

  if (!pet) return null;

  const xpPct = pet.xp / Math.max(1, pet.xp + pet.xpToNextLevel);
  const hpPct = pet.currentHp / Math.max(1, pet.maxHp);

  return (
    <Layout>
      <PageHeader
        title="Pet"
        subtitle={
          pets.length > 0 ? (
            <>Roster: {pets.length} pet{pets.length === 1 ? '' : 's'}</>
          ) : (
            'Your loyal companion'
          )
        }
      />

      {/* Roster selector — one card per pet. Click to inspect. The
          active pet (white border) is the one the actions operate on. */}
      {pets.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6 mb-4 max-w-4xl">
          {pets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPetId(p.id)}
              className={`text-left rounded border p-2 transition-all bg-bg-900/40 hover:bg-bg-900/80 ${
                p.id === activePetId
                  ? 'border-neon-cyan'
                  : 'border-neon-cyan/20 hover:border-neon-cyan/50'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-sm font-display text-neon-cyan truncate">{p.name}</span>
                {p.deployed && (
                  <span
                    className="text-[9px] font-mono uppercase tracking-widest text-neon-lime border border-neon-lime/40 rounded px-1"
                    title="Deployed in combat"
                  >
                    LIVE
                  </span>
                )}
                {p.faintedAt && (
                  <span className="text-[9px] font-mono uppercase tracking-widest text-neon-magenta border border-neon-magenta/40 rounded px-1">
                    KO
                  </span>
                )}
              </div>
              <img
                src={p.spritePath}
                alt={p.name}
                width={64}
                height={64}
                className="pixelated w-full max-w-[64px] h-auto mx-auto"
                style={{ imageRendering: 'pixelated' }}
              />
              <div className="text-center mt-1">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
                  Lv {p.level} · {p.stage}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[260px_1fr] max-w-4xl">
        {/* Sprite */}
        <Panel variant="cyan" className="flex items-center justify-center p-2">
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
                <div className="h-3 bg-bg-900 border border-neon-lime/30 rounded">
                  <div
                    className={classNames(
                      'h-full rounded transition-all',
                      pet.isFainted ? 'bg-neon-magenta' : 'bg-neon-lime',
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
                {pet.level >= 15 ? (
                  <div className="rounded border border-neon-cyan/20 p-2 text-center">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Attack</div>
                    <div className="text-2xl font-display text-neon-cyan">{pet.attack}</div>
                  </div>
                ) : (
                  <div className="rounded border border-neon-cyan/20 p-2 text-center opacity-50">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Attack</div>
                    <div className="text-xs font-mono text-ink-400 mt-1">unlocks at Lv 15</div>
                  </div>
                )}
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
                    Feed
                    <span className="ml-2 text-ink-400">
                      {(() => {
                        if (!pet.canFeed) return '(fainted)';
                        if (cooldownMs <= 0) return null;
                        return `(ready in ${formatCooldown(cooldownMs)})`;
                      })()}
                    </span>
                  </div>
                  {petFoods.length > 1 && (
                    <select
                      value={selectedFoodId ?? ''}
                      onChange={(e) => setSelectedFoodId(e.target.value || null)}
                      className="rounded border border-neon-cyan/30 bg-bg-900 px-2 py-1 text-xs text-ink-100 focus:outline-none focus:border-neon-cyan"
                    >
                      {petFoods.map((f) => (
                        <option key={f.id} value={f.id} disabled={f.owned === 0}>
                          {f.name} ({f.owned} owned)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Inline food card — always show if foods exist */}
                {petFoods.length > 0 && (
                  <div className="mt-2 rounded border border-neon-cyan/30 bg-bg-900/40 p-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-display text-neon-cyan">
                        {petFoods.find((f) => f.id === selectedFoodId)?.name ?? petFoods[0].name}
                      </div>
                      <div className="text-[10px] font-mono text-ink-300">
                        Owned: <span className="text-neon-cyan">
                          {petFoods.find((f) => f.id === selectedFoodId)?.owned ?? petFoods[0].owned}
                        </span>
                        {' · '}
                        {petFoods.find((f) => f.id === selectedFoodId)?.cost ?? petFoods[0].cost}g each
                      </div>
                      {/* Full-state message — clear, readable */}
                      {pet.canFeed && cooldownMs > 0 && (
                        <div className="mt-2 text-xs font-mono text-neon-amber">
                          {pet.name} is full. You can feed {pet.name} again in {formatCooldown(cooldownMs)}.
                        </div>
                      )}
                      {!pet.canFeed && !pet.isFainted && (
                        <div className="mt-2 text-xs font-mono text-neon-cyan">
                          {pet.name} is hungry!
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!ownsFood && (
                        <Link
                          to="/shop"
                          className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan hover:text-neon-cyan/80 underline"
                        >
                          buy →
                        </Link>
                      )}
                      <NeonButton
                        variant="lime"
                        disabled={
                          !pet.canFeed ||
                          cooldownMs > 0 ||
                          !ownsFood ||
                          feedM.isPending
                        }
                        onClick={() => {
                          const f = petFoods.find((x) => x.id === selectedFoodId) ?? petFoods[0];
                          feedM.mutate({ foodItemId: f.id, count: 1, petId: pet.id });
                        }}
                      >
                        {feedM.isPending ? 'Feeding…' : 'Feed (+5 XP)'}
                      </NeonButton>
                    </div>
                  </div>
                )}

                {petFoods.length === 0 && pet.canFeed && (
                  <div className="mt-2 text-xs text-neon-amber border border-neon-amber/30 rounded p-2">
                    No food for {pet.breed.displayName} in stock.{' '}
                    <Link to="/shop" className="underline">Visit the shop</Link>.
                  </div>
                )}

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
                    onClick={() => armorM.mutate(pet.id)}
                  >
                    {armorM.isPending ? '…' : pet.isArmored ? 'Remove Armor' : 'Equip Armor'}
                  </NeonButton>
                </div>
                {armorError && <div className="text-xs text-neon-magenta mt-1">{armorError}</div>}
              </div>

              {/* Deploy (combat XP eligibility) */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
                    Deploy · {pet.deployed ? 'IN' : 'out'}
                    <span className="ml-2 text-ink-400">
                      {pet.canDeploy
                        ? pet.deployed
                          ? '(gains combat XP)'
                          : '(unlocks at Lv 15, deploy to gain combat XP)'
                        : pet.isFainted
                        ? '(fainted, vet first)'
                        : pet.level < 15
                        ? `(unlocks at Lv 15, you are Lv ${pet.level})`
                        : ''}
                    </span>
                  </div>
                  <NeonButton
                    variant={pet.deployed ? 'cyan' : 'amber'}
                    disabled={!pet.canDeploy || deployM.isPending}
                    onClick={() => deployM.mutate(pet.id)}
                  >
                    {deployM.isPending ? '…' : pet.deployed ? 'Recall' : 'Deploy'}
                  </NeonButton>
                </div>
                {deployError && <div className="text-xs text-neon-magenta mt-1">{deployError}</div>}
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
                    onClick={() => vetM.mutate(pet.id)}
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