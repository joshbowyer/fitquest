import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';

// =============================================================
// Pet shop API types. /shop/pet-stock returns the breed list;
// /shop/items returns the consumables catalog (Vital Tonic,
// Kibble, Rainbow Worms, etc.). Both go through the same
// /shop/purchase endpoint to debit gold.
// =============================================================
type PetStockEntry = {
  breed: {
    id: string;
    slug: string;
    displayName: string;
    species: string;
    costGold: number;
    description: string;
    baseHp: number;
    baseAttack: number;
    spriteBasePath: string;
    colorVariants: string[];
    spriteStages: string[];
    isStarter: boolean;
  };
  defaultColorVariant: string;
  defaultSpritePath: string;
  foodEffectKey: string;
};

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
  stage: string;
  level: number;
  spritePath: string;
  breed: {
    species: string;
  };
};

type PetRoster = {
  pets: Pet[];
  primaryPetId: string | null;
};

export function ShopPage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const [buyError, setBuyError] = useState<string | null>(null);
  const [foodError, setFoodError] = useState<string | null>(null);
  const [selectedBreedId, setSelectedBreedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [variant, setVariant] = useState<string | null>(null);
  const [busyFoodId, setBusyFoodId] = useState<string | null>(null);

  const stockQ = useQuery({
    queryKey: ['shop', 'pet-stock'],
    queryFn: () => api<{ breeds: PetStockEntry[] }>('/shop/pet-stock'),
  });

  const myPetQ = useQuery({
    queryKey: ['pet'],
    queryFn: () => api<PetRoster>('/pet'),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });

  const itemsQ = useQuery({
    queryKey: ['shop', 'items'],
    queryFn: () => api<{ items: ShopItem[] }>('/shop/items'),
  });

  const buyM = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; petId: string; gold: number; error?: string }>('/shop/buy-pet', {
        method: 'POST',
        body: {
          breedId: selectedBreedId,
          name: name.trim(),
          colorVariant: variant,
        },
      }),
    onSuccess: () => {
      setBuyError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
      qc.invalidateQueries({ queryKey: ['shop', 'pet-stock'] });
      // The auth context stores the user object separately from
      // react-query, so invalidating ['user'] does nothing. Call
      // refresh() directly to update the hero-bar gold immediately.
      refresh();
    },
    onError: (e: Error) => {
      setBuyError(e instanceof ApiError ? e.message : 'Purchase failed');
    },
  });

  const buyFoodM = useMutation({
    mutationFn: (itemId: string) =>
      api<{ ok: boolean; gold: number }>('/shop/purchase', {
        method: 'POST',
        body: { itemId },
      }),
    onSuccess: () => {
      setFoodError(null);
      qc.invalidateQueries({ queryKey: ['shop', 'items'] });
      refresh();
      setBusyFoodId(null);
    },
    onError: (e: Error) => {
      setFoodError(e instanceof ApiError ? e.message : 'Could not buy food');
      setBusyFoodId(null);
    },
  });

  const breeds = stockQ.data?.breeds ?? [];
  const items = itemsQ.data?.items ?? [];
  const myPet = myPetQ.data?.pets[0] ?? null; // primary pet (oldest)
  const ownsPet = myPet !== null;

  // Pet foods only — items whose effectKey starts with `pet_food_`.
  // Match by species for the user's pet to highlight the right one.
  const myPetSpecies = myPet?.breed?.species ?? null;
  const petFoods = items.filter((it) => it.effectKey.startsWith('pet_food_'));
  const myPetFoods = myPetSpecies
    ? petFoods.filter((it) => it.effectKey === `pet_food_${myPetSpecies}`)
    : [];
  const allPetFoods = petFoods;

  // When the user picks a breed, prep its defaults.
  function pickBreed(b: PetStockEntry) {
    setSelectedBreedId(b.breed.id);
    setName((n) => n || b.breed.displayName.split(' ')[0]);
    setVariant(b.defaultColorVariant);
  }

  const selectedBreed = breeds.find((b) => b.breed.id === selectedBreedId) ?? null;
  const validName = name.trim().length >= 1 && name.trim().length <= 24;
  const canAffordPet = selectedBreed
    ? (user?.gold ?? 0) >= selectedBreed.breed.costGold
    : false;

  return (
    <Layout>
      <PageHeader
        title="Pet Shop"
        subtitle={
          ownsPet
            ? 'You already have a companion. Visit your pet.'
            : 'Adopt a loyal companion. They grow with you.'
        }
      />

      {/* === BREEDS === */}
      {stockQ.isLoading && (
        <Panel variant="cyan"><div className="text-ink-300">Loading…</div></Panel>
      )}
      {stockQ.error && (
        <Panel variant="magenta" title="Shop unavailable">
          <div className="text-ink-300 text-sm">
            {stockQ.error instanceof ApiError ? stockQ.error.message : 'Could not load the shop.'}
          </div>
        </Panel>
      )}

      {breeds.length > 0 && (
        <Panel
          variant="cyan"
          title={
            ownsPet
              ? 'Your companion'
              : (myPetQ.data?.pets?.length ?? 0) >= 6
              ? 'Roster full'
              : 'Available breeds'
          }
        >
          {ownsPet && myPet ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-display text-2xl text-neon-cyan">{myPet.name}</div>
                <div className="text-xs text-ink-300 mt-1">Level {myPet.level} · {myPet.stage}</div>
              </div>
              <Link to="/pet">
                <NeonButton variant="cyan">Visit your pet</NeonButton>
              </Link>
            </div>
          ) : (myPetQ.data?.pets?.length ?? 0) >= 6 ? (
            /* Roster full — no pets adopted yet, but at cap (impossible
               in practice, since the cap can only be hit AFTER
               adopting). Edge case: defensive UI. */
            <div className="text-center py-6">
              <div className="text-sm text-ink-300">Your roster is full (6/6).</div>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
                  Pick a breed to adopt
                </div>
                <div className="text-[10px] font-mono text-ink-400">
                  Roster: {myPetQ.data?.pets?.length ?? 0}/6
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {breeds.map((b) => (
                  <BreedCard
                    key={b.breed.id}
                    entry={b}
                    selected={selectedBreedId === b.breed.id}
                    canAfford={(user?.gold ?? 0) >= b.breed.costGold}
                    onPick={() => pickBreed(b)}
                  />
                ))}
              </div>

              {selectedBreed && (
                <div className="border-t border-neon-cyan/20 mt-4 pt-4 space-y-3">
                  <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
                    Adopt {selectedBreed.breed.displayName}
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      maxLength={24}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Rex"
                      className="w-full rounded border border-neon-cyan/30 bg-bg-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:outline-none focus:border-neon-cyan"
                    />
                  </div>

                  {selectedBreed.breed.colorVariants.length > 1 && (
                    <div>
                      <label className="block text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                        Color variant
                      </label>
                      <select
                        value={variant ?? selectedBreed.defaultColorVariant}
                        onChange={(e) => setVariant(e.target.value)}
                        className="w-full rounded border border-neon-cyan/30 bg-bg-900 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-neon-cyan"
                      >
                        {selectedBreed.breed.colorVariants.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(myPetQ.data?.pets?.length ?? 0) >= 6 && (
                    <div className="text-xs text-neon-amber border border-neon-amber/30 rounded p-2">
                      Roster full (6/6). Release a pet on{' '}
                      <Link to="/pet" className="underline">/pet</Link> to make room.
                    </div>
                  )}
                  {!canAffordPet && (
                    <div className="text-xs text-neon-magenta border border-neon-magenta/30 rounded p-2">
                      Not enough gold. {selectedBreed.breed.costGold}g required, you have {user?.gold ?? 0}.
                    </div>
                  )}
                  {buyError && (
                    <div className="text-xs text-neon-magenta border border-neon-magenta/30 rounded p-2">
                      {buyError}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] text-ink-300">
                      Feeds from <span className="text-neon-cyan">pet food shop</span> below. Needs{' '}
                      <span className="text-neon-amber">{selectedBreed.foodEffectKey}</span> matches.
                    </div>
                    <NeonButton
                      variant="cyan"
                      disabled={!validName || !canAffordPet || buyM.isPending}
                      onClick={() => buyM.mutate()}
                    >
                      {buyM.isPending ? 'Adopting…' : `Adopt for ${selectedBreed.breed.costGold}g`}
                    </NeonButton>
                  </div>
                </div>
              )}
            </>
          )}
        </Panel>
      )}

      {/* === PET FOOD === */}
      <div className="mt-6">
        <Panel variant="cyan" title="Pet food">
          <div className="grid gap-3 md:grid-cols-2">
            {allPetFoods.map((f) => {
              const matchesMine = myPetSpecies ? f.effectKey === `pet_food_${myPetSpecies}` : false;
              const canAfford = (user?.gold ?? 0) >= f.cost;
              return (
                <div
                  key={f.id}
                  className="rounded border border-neon-cyan/30 p-3 bg-bg-900/40 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-neon-cyan">{f.name}</span>
                      {matchesMine && (
                        <span className="text-[10px] font-mono uppercase tracking-widest text-neon-lime border border-neon-lime/30 rounded px-1.5 py-0.5">
                          for your pet
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-ink-300">
                        ({f.effectKey.replace('pet_food_', '')})
                      </span>
                    </div>
                    <div className="text-xs text-ink-300 mt-1">{f.description}</div>
                    <div className="text-[10px] font-mono text-ink-400 mt-1">
                      Owned: <span className="text-neon-cyan">{f.owned}</span>
                    </div>
                  </div>
                  <NeonButton
                    variant="lime"
                    disabled={!canAfford || buyFoodM.isPending}
                    onClick={() => {
                      setBusyFoodId(f.id);
                      buyFoodM.mutate(f.id);
                    }}
                  >
                    {buyFoodM.isPending && busyFoodId === f.id
                      ? '…'
                      : `Buy (${f.cost}g)`}
                  </NeonButton>
                </div>
              );
            })}
            {allPetFoods.length === 0 && (
              <div className="text-ink-300 text-sm">No pet food in stock right now.</div>
            )}
          </div>
          {foodError && (
            <div className="text-xs text-neon-magenta border border-neon-magenta/30 rounded p-2 mt-3">
              {foodError}
            </div>
          )}
        </Panel>
      </div>
    </Layout>
  );
}

// ====== Breed card ======
function BreedCard({
  entry,
  selected,
  canAfford,
  onPick,
}: {
  entry: PetStockEntry;
  selected: boolean;
  canAfford: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`text-left rounded border p-2 transition-all bg-bg-900/40 hover:bg-bg-900/80 ${
        selected ? 'border-neon-cyan' : 'border-neon-cyan/20 hover:border-neon-cyan/50'
      }`}
    >
      <img
        src={entry.defaultSpritePath}
        alt={entry.breed.displayName}
        width={256}
        height={256}
        className="pixelated w-full max-w-[200px] h-auto mx-auto"
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="text-center mt-2">
        <div className="font-display text-base text-neon-cyan">{entry.breed.displayName}</div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mt-1">
          {entry.breed.species} · {entry.breed.colorVariants[0]}
        </div>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-xs font-display text-neon-amber">{entry.breed.costGold}g</span>
          {!canAfford && <span className="text-[10px] text-neon-magenta">not enough</span>}
          {entry.breed.isStarter && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-neon-lime border border-neon-lime/30 rounded px-1.5 py-0.5">
              starter
            </span>
          )}
        </div>
      </div>
    </button>
  );
}