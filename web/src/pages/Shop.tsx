import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';

// =============================================================
// Pet shop API types — same shapes the backend returns from
// /shop/pet-stock and /shop/buy-pet.
// =============================================================
type PetStock = {
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
  };
  colorVariant: string;
  spritePath: string;
  availableUntil: string | null;
};

type Pet = {
  id: string;
  name: string;
  stage: string;
  level: number;
  spritePath: string;
};

export function ShopPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [variant, setVariant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stockQ = useQuery({
    queryKey: ['shop', 'pet-stock'],
    queryFn: () => api<PetStock>('/shop/pet-stock'),
  });

  // Probe /pet to know whether the user already owns one.
  const myPetQ = useQuery({
    queryKey: ['pet'],
    queryFn: () => api<Pet>('/pet'),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });

  const buyM = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; petId: string; gold: number }>('/shop/buy-pet', {
        method: 'POST',
        body: { name: name.trim(), colorVariant: variant },
      }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['pet'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['shop', 'pet-stock'] });
    },
    onError: (e: Error) => {
      setError(e instanceof ApiError ? e.message : 'Purchase failed');
    },
  });

  const stock = stockQ.data;
  const myPet = myPetQ.data;
  const ownsPet = !!myPet && !(myPetQ.error instanceof ApiError && myPetQ.error.status === 404);
  const canAfford = (user?.gold ?? 0) >= (stock?.breed.costGold ?? Infinity);
  const validName = name.trim().length >= 1 && name.trim().length <= 24;

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

      {stock && (
        <div className="grid gap-4 md:grid-cols-[300px_1fr] max-w-4xl">
          {/* Sprite */}
          <Panel variant="cyan" title={stock.breed.displayName} className="flex items-center justify-center p-2">
            <img
              src={stock.spritePath}
              alt={stock.breed.displayName}
              width={256}
              height={256}
              className="pixelated w-full max-w-[256px] h-auto"
              style={{ imageRendering: 'pixelated' }}
            />
          </Panel>

          {/* Hero card */}
          <div className="space-y-4">
            <Panel variant="cyan" title={`This week's puppy`}>
              <div className="space-y-3">
                <div className="text-sm text-ink-200">{stock.breed.description}</div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="rounded border border-neon-cyan/20 p-2 text-center">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Cost</div>
                    <div className="text-2xl font-display text-neon-amber">{stock.breed.costGold}g</div>
                  </div>
                  <div className="rounded border border-neon-cyan/20 p-2 text-center">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Your gold</div>
                    <div className="text-2xl font-display text-neon-cyan">{user?.gold ?? 0}</div>
                  </div>
                </div>

                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 pt-1">
                  Base stats (Lv1 puppy): HP {stock.breed.baseHp} · Attack {stock.breed.baseAttack}
                </div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
                  Grows with you: auto-trains from workout XP, evolves to adult at Lv 5.
                </div>

                {ownsPet ? (
                  <Link to="/pet">
                    <NeonButton variant="cyan" className="w-full mt-2">Visit your pet</NeonButton>
                  </Link>
                ) : (
                  <>
                    {/* Adoption form */}
                    <div className="border-t border-neon-cyan/20 pt-3 space-y-2">
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

                      {stock.breed.colorVariants.length > 1 && (
                        <div>
                          <label className="block text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                            Color variant
                          </label>
                          <select
                            value={variant ?? stock.colorVariant}
                            onChange={(e) => setVariant(e.target.value)}
                            className="w-full rounded border border-neon-cyan/30 bg-bg-900 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-neon-cyan"
                          >
                            {stock.breed.colorVariants.map((v) => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {!canAfford && (
                        <div className="text-xs text-neon-magenta border border-neon-magenta/30 rounded p-2">
                          Not enough gold. You need {stock.breed.costGold}g.
                        </div>
                      )}
                      {error && (
                        <div className="text-xs text-neon-magenta border border-neon-magenta/30 rounded p-2">
                          {error}
                        </div>
                      )}

                      <NeonButton
                        variant="cyan"
                        disabled={!validName || !canAfford || buyM.isPending}
                        onClick={() => buyM.mutate()}
                        className="w-full"
                      >
                        {buyM.isPending
                          ? 'Adopting…'
                          : `Adopt for ${stock.breed.costGold}g`}
                      </NeonButton>
                    </div>
                  </>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </Layout>
  );
}