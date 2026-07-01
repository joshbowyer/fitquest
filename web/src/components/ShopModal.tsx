/**
 * ShopModal — the Bazaar popup.
 *
 * Opened by clicking the BAZAAR star on the constellation map
 * (above Home Base). Shows the 4 buyable items (Vital Tonic,
 * War Tincture, Continuity Rune, Forge Tonic) with the bazaar
 * background image at /shop/bazaar-bg.png. Each item has a Buy
 * button that calls POST /shop/purchase.
 *
 * Inventory items (War Tincture, Continuity Rune, Forge Tonic)
 * are listed separately — items the user owns that haven't
 * expired yet. The user can see "your War Tincture expires in
 * 18h" etc.
 *
 * Designed to feel like walking into a market stall: dim warm
 * light, amber accents, a chalkboard-style "PRICES" header. The
 * items float in their own little cards so the bazaar image
 * reads as backdrop, not as the focal point.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Modal } from './Modal';
import { NeonButton } from './NeonButton';
import { classNames } from '@/lib/format';

type ShopItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  cost: number;
  effectKey: string;
  effectValue: number;
  effectDurationSec: number | null;
  owned: number;
};

type InventoryItem = {
  id: string;
  itemId: string;
  name: string;
  description: string;
  effectKey: string;
  purchasedAt: string;
  expiresAt: string | null;
  isExpired: boolean;
};

function formatTimeRemaining(expiresAt: string | null): string {
  if (!expiresAt) return 'one-shot';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.round(ms / 60000)}m left`;
  if (hours < 24) return `${Math.round(hours)}h left`;
  return `${Math.round(hours / 24)}d left`;
}

const EFFECT_COLOR: Record<string, string> = {
  heart_refill:    'text-neon-magenta',
  raid_buff:       'text-neon-red',
  streak_shield:  'text-neon-cyan',
  pr_doubler:      'text-neon-goldenrod',
};

const EFFECT_LABEL: Record<string, string> = {
  heart_refill:    'Hearts',
  raid_buff:       'Raid Dmg',
  streak_shield:  'Streak',
  pr_doubler:      'PR Bonus',
};

export function ShopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<string | null>(null);

  const itemsQ = useQuery({
    queryKey: ['shop', 'items'],
    queryFn: () => api<{ items: ShopItem[] }>('/shop/items'),
    enabled: open,
  });
  const invQ = useQuery({
    queryKey: ['shop', 'inventory'],
    queryFn: () => api<{ items: InventoryItem[] }>('/shop/inventory'),
    enabled: open,
    refetchInterval: open ? 30000 : false,
  });

  const buyM = useMutation({
    mutationFn: (itemId: string) =>
      api<{ ok: boolean; gold: number; hearts: number; error?: string }>('/shop/purchase', {
        method: 'POST',
        body: { itemId },
      }),
    onSuccess: (res, itemId) => {
      if (res.ok) {
        setPurchased(itemId);
        setError(null);
        qc.invalidateQueries({ queryKey: ['shop', 'items'] });
        qc.invalidateQueries({ queryKey: ['shop', 'inventory'] });
        qc.invalidateQueries({ queryKey: ['user'] });
        // Clear the "just bought" indicator after a moment
        setTimeout(() => setPurchased(null), 1500);
      } else {
        setError(res.error ?? 'Purchase failed');
      }
      setBusyId(null);
    },
    onError: (e: Error) => {
      setError(e instanceof ApiError ? e.message : 'Could not reach the shop');
      setBusyId(null);
    },
  });

  const items = itemsQ.data?.items ?? [];
  const inventory = invQ.data?.items ?? [];

  return (
    <Modal open={open} onClose={onClose} title="The Bazaar" width="max-w-4xl">
      <div className="relative -mx-6 -mt-2 mb-4">
        {/* Bazaar backdrop — fixed behind the items */}
        <div
          className="h-32 rounded-t border border-neon-amber/30"
          style={{
            backgroundImage: 'url(/shop/bazaar-bg.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="h-full w-full bg-gradient-to-b from-bg-900/40 to-bg-900/90 flex items-center justify-center">
            <div className="text-center">
              <div className="font-display text-2xl tracking-widest text-neon-amber drop-shadow-[0_0_8px_rgba(255,170,58,0.6)]">
                THE BAZAAR
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mt-1">
                Spend gold. Skip cooldowns. Bend time.
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 border border-neon-red/40 bg-neon-red/10 text-xs font-mono text-neon-red rounded">
          {error}
        </div>
      )}

      {/* Items for sale */}
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2 px-1">
        For sale
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {itemsQ.isLoading && (
          <div className="text-xs font-mono text-ink-400 col-span-full text-center py-4">
            Loading the market…
          </div>
        )}
        {items.map((item) => {
          const justBought = purchased === item.id;
          return (
            <div
              key={item.id}
              className={classNames(
                'p-3 border-2 transition-all',
                justBought
                  ? 'border-neon-amber bg-neon-amber/10'
                  : 'border-ink-700/50 bg-bg-800/60 hover:border-neon-amber/60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className={classNames(
                    'font-display tracking-wide text-sm',
                    EFFECT_COLOR[item.effectKey] ?? 'text-ink-100',
                  )}>
                    {item.name}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mt-0.5">
                    {EFFECT_LABEL[item.effectKey] ?? item.effectKey}
                    {' · '}
                    {item.effectDurationSec
                      ? `${Math.round(item.effectDurationSec / 3600)}h effect`
                      : 'instant'}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-neon-amber font-bold text-lg leading-none">
                    {item.cost}<span className="text-[10px] text-ink-300 ml-0.5">g</span>
                  </div>
                  {item.owned > 0 && (
                    <div className="text-[10px] font-mono text-neon-lime mt-0.5">
                      owned: {item.owned}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-ink-200 mt-2 leading-snug">
                {item.description}
              </div>
              <div className="mt-2.5 flex justify-end">
                <NeonButton
                  variant="amber"
                  size="sm"
                  loading={busyId === item.id}
                  disabled={busyId !== null && busyId !== item.id}
                  onClick={() => {
                    setBusyId(item.id);
                    setError(null);
                    buyM.mutate(item.id);
                  }}
                >
                  {justBought ? '✓ Acquired' : `Buy for ${item.cost}g`}
                </NeonButton>
              </div>
            </div>
          );
        })}
      </div>

      {/* Inventory */}
      {inventory.length > 0 && (
        <>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2 px-1">
            Your satchel
          </div>
          <div className="space-y-1.5">
            {inventory.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 px-3 py-2 border border-ink-700/40 bg-bg-700/40 text-xs"
              >
                <div className="flex-1">
                  <div className="font-mono text-ink-100">{inv.name}</div>
                  <div className="text-[10px] text-ink-400">
                    {inv.description}
                  </div>
                </div>
                <div className="text-[10px] font-mono text-neon-amber whitespace-nowrap">
                  {formatTimeRemaining(inv.expiresAt)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-4 pt-3 border-t border-ink-700/30 flex justify-end">
        <NeonButton variant="cyan" onClick={onClose}>
          Leave the Bazaar
        </NeonButton>
      </div>
    </Modal>
  );
}
