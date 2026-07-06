import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { useAuth } from '@/lib/auth';
import { NeonButton } from '@/components/NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABEL,
  EQUIP_SLOT_GLYPH,
  RARITY_COLOR,
  RARITY_LABEL,
  RARITY_ORDER,
  STAT_LABEL,
  type EquipSlot,
  type InventoryItem,
  type ItemDef,
  type ItemRarity,
  type ItemSource,
} from '@/lib/types';
import { classNames, formatRelative } from '@/lib/format';

import { primaryColorForClass, WORLD_COLOR_HEX } from '@/lib/quest';

type Catalog = ItemDef[];

type InventoryResponse = {
  items: InventoryItem[];
  equipped: Record<EquipSlot, InventoryItem | null>;
};

type StatsResponse = {
  totals: Record<string, number>;
  setCounts: Record<string, number>;
};

const RARITY_FILTERS: Array<ItemRarity | 'ALL'> = ['ALL', 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];

const SOURCE_LABEL: Record<ItemSource, string> = {
  MONSTER_DROP: 'Monster drop',
  BOSS_DROP:    'Boss drop',
  QUEST_REWARD: 'Quest reward',
  SHOP:         'Shop',
  CRAFTED:      'Crafted',
  ACHIEVEMENT:  'Achievement',
  STARTER_KIT:  'Starter kit',
};

function fmtStatValue(key: string, v: number): string {
  if (key === '+CRIT' || key === '+EVA' || key === '+HEAL' || key === '+BURST' || key === '+DISC' || key === '+XP' || key === '+GOLD') {
    return `${(v * 100).toFixed(0)}%`;
  }
  return `+${v}`;
}

export function InventoryPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  if (!user) return null;

  const invQ = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<InventoryResponse>('/inventory'),
  });
  const catalogQ = useQuery({
    queryKey: ['items', 'catalog'],
    queryFn: () => api<{ items: Catalog }>('/items?limit=500'),
  });
  const statsQ = useQuery({
    queryKey: ['inventory', 'stats'],
    queryFn: () => api<StatsResponse>('/inventory/stats'),
  });

  const [rarityFilter, setRarityFilter] = useState<ItemRarity | 'ALL'>('ALL');
  const [slotFilter, setSlotFilter] = useState<EquipSlot | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const equipM = useDelayedMutation({
    mutationFn: (itemId: string) =>
      api<{ ok: boolean; slot: EquipSlot }>('/inventory/equip', {
        method: 'POST',
        body: { itemId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory', 'stats'] });
    },
  }, 800);

  const unequipM = useDelayedMutation({
    mutationFn: (itemId: string) =>
      api<{ ok: boolean }>('/inventory/unequip', {
        method: 'POST',
        body: { itemId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory', 'stats'] });
    },
  }, 800);

  const items = invQ.data?.items ?? [];
  const equipped = invQ.data?.equipped ?? ({} as Record<EquipSlot, InventoryItem | null>);
  const totals = statsQ.data?.totals ?? {};
  const setCounts = statsQ.data?.setCounts ?? {};

  // Filter catalog by rarity + slot
  const filteredCatalog = (catalogQ.data?.items ?? []).filter((it) => {
    if (rarityFilter !== 'ALL' && it.rarity !== rarityFilter) return false;
    if (slotFilter !== 'ALL' && it.slot !== slotFilter) return false;
    return true;
  });

  // Owned items not yet equipped, grouped by slot
  const ownedBySlot = useMemo(() => {
    const m: Record<EquipSlot, InventoryItem[]> = {} as any;
    for (const slot of EQUIP_SLOTS) m[slot] = [];
    for (const it of items) {
      if (!it.equippedSlot) m[it.itemDef.slot].push(it);
    }
    return m;
  }, [items]);

  const selectedItem = items.find((it) => it.id === selectedId) ?? null;
  // selectedId can be `def:<id>` for unowned catalog picks — resolve that
  // against the catalog so we can still show the item's stats + sprite.
  const unownedDef: ItemDef | null =
    selectedId?.startsWith('def:')
      ? (catalogQ.data?.items ?? []).find((it) => it.id === selectedId.slice(4)) ?? null
      : null;
  const selectedDef: ItemDef | null = selectedItem?.itemDef ?? unownedDef;

  return (
    <Layout>
      <PageHeader
        title="Inventory"
        subtitle="Equipment from drops, quests, and the shop. Equip a piece to add its stats to your build."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          {/* Equipped loadout — text only when empty, item icon when
              filled. No more default slot-glyph fallback that made
              every slot look the same. */}
          <Panel title="EQUIPPED LOADOUT" variant="cyan">
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              {EQUIP_SLOTS.map((slot) => {
                const it = equipped[slot];
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => it && setSelectedId(it.id)}
                    className={classNames(
                      'flex flex-col items-center p-2 border aspect-square transition-all',
                      it
                        ? 'border-neon-cyan/40 bg-neon-cyan/5 hover:border-neon-cyan cursor-pointer'
                        : 'border-ink-500/20 bg-transparent cursor-default',
                    )}
                    title={it ? `${EQUIP_SLOT_LABEL[slot]}: ${it.itemDef.name}` : `${EQUIP_SLOT_LABEL[slot]} (empty)`}
                  >
                    <span className="text-[10px] font-mono text-ink-400 tracking-widest uppercase">
                      {EQUIP_SLOT_LABEL[slot]}
                    </span>
                    {it ? (
                      <img
                        src={`/sprites/${it.itemDef.sprite.endsWith('.png') ? it.itemDef.sprite : it.itemDef.sprite + '.png'}`}
                        alt={it.itemDef.name}
                        width={48}
                        height={48}
                        className="my-1 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="text-[10px] font-mono text-ink-600 italic my-1">empty</span>
                    )}
                    <span className="text-[9px] font-mono text-center truncate w-full" style={{ color: it ? RARITY_COLOR[it.itemDef.rarity] : '#585868' }}>
                      {it ? it.itemDef.name : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>

          {/* Soulstones — display only. Use the link below to spend one
              in /profile (Class change confirmation). We intentionally
              don't allow spending from here because the modal needs the
              pendingClass state, which only lives on /profile. */}
          <Panel
            title="SOULSTONES"
            variant="amber"
            action={
              <span className="text-[10px] font-mono text-ink-300 tracking-widest">
                {user.soulstones ?? 0} active
              </span>
            }
          >
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 flex items-center justify-center text-3xl border border-neon-amber/40 bg-neon-amber/5 shrink-0"
                aria-hidden
              >
                💎
              </div>
              <div className="flex-1 text-[10px] font-mono">
                <div className="text-ink-100">
                  <span className="neon-text-amber font-bold">{user.soulstones ?? 0}</span>{' '}
                  <span className="text-ink-300">
                    {(user.soulstones ?? 0) === 1 ? 'soulstone' : 'soulstones'} in inventory
                  </span>
                </div>
                <div className="text-ink-400 mt-1">
                  Soulstones bypass the once-per-year class lock. Bypass via{' '}
                  <Link
                    to="/profile"
                    className="neon-text-amber hover:underline"
                    onClick={() => {
                      // Scroll the profile page to the Class panel so
                      // the user lands right on the class-change UI.
                      // (The Profile page reads location.hash to jump.)
                      window.location.hash = 'class';
                    }}
                  >
                    Profile → Class
                  </Link>
                  .
                </div>
                <div className="text-ink-500 mt-0.5 text-[9px]">
                  Each stone is one consumable class change. They expire 7 days
                  after dropping from a world-boss kill.
                </div>
              </div>
            </div>
          </Panel>

          {/* Item catalog — full browse, dimming unowned entries */}
          <Panel
            title="ITEM CATALOG"
            variant="magenta"
            action={
              <span className="text-[10px] font-mono text-ink-300 tracking-widest">
                {items.length} owned · {catalogQ.data?.items.length ?? 0} total
              </span>
            }
          >
            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="flex flex-wrap gap-1">
                {RARITY_FILTERS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRarityFilter(r)}
                    className={classNames(
                      'px-2 py-0.5 text-[9px] font-mono tracking-widest uppercase border',
                      rarityFilter === r
                        ? r === 'ALL' ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' : 'border-current'
                        : 'border-ink-500/40 text-ink-300',
                    )}
                    style={rarityFilter === r && r !== 'ALL' ? { color: RARITY_COLOR[r as ItemRarity] } : undefined}
                  >
                    {r === 'ALL' ? 'All rarities' : RARITY_LABEL[r as ItemRarity]}
                  </button>
                ))}
              </div>
              <span className="text-ink-500">·</span>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSlotFilter('ALL')}
                  className={classNames(
                    'px-2 py-0.5 text-[9px] font-mono tracking-widest uppercase border',
                    slotFilter === 'ALL' ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' : 'border-ink-500/40 text-ink-300',
                  )}
                >
                  All slots
                </button>
                {EQUIP_SLOTS.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSlotFilter(slot)}
                    className={classNames(
                      'px-2 py-0.5 text-[9px] font-mono tracking-widest uppercase border',
                      slotFilter === slot ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' : 'border-ink-500/40 text-ink-300',
                    )}
                  >
                    {EQUIP_SLOT_LABEL[slot]}
                  </button>
                ))}
              </div>
            </div>

            {filteredCatalog.length === 0 ? (
              <div className="text-[10px] font-mono text-ink-300 italic text-center py-6 border border-dashed border-ink-700/30">
                No items match these filters. Drops come from monster kills and bosses — keep training.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {filteredCatalog.map((def) => {
                  const owned = items.filter((it) => it.itemDefId === def.id);
                  const equippedCount = owned.filter((it) => it.equippedSlot === def.slot).length;
                  const ownedCount = owned.length;
                  const isOwned = ownedCount > 0;
                  const isSelected = selectedDef?.id === def.id;
                  return (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => setSelectedId(isOwned ? owned[0].id : `def:${def.id}`)}
                      className={classNames(
                        'relative p-2 border bg-bg-900/40 transition-all text-left',
                        isSelected ? 'border-neon-cyan shadow-neon-cyan' : isOwned ? 'border-ink-500/40 hover:border-ink-300' : 'border-ink-500/20 opacity-40 hover:opacity-60',
                      )}
                      title={isOwned ? def.name : `${def.name} — not yet owned`}
                    >
                      <div
                        className="aspect-square w-full flex items-center justify-center bg-bg-800/60 mb-1 overflow-hidden relative"
                        style={{ minHeight: '70px' }}
                      >
                        <img
                          src={`/sprites/${def.sprite.endsWith('.png') ? def.sprite : def.sprite + '.png'}`}
                          alt={def.name}
                          width={90}
                          height={90}
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          onError={(e) => {
                            // Swap to a placeholder glyph if the sprite 404s.
                            const el = e.currentTarget as HTMLImageElement;
                            el.style.display = 'none';
                            const parent = el.parentElement;
                            if (parent && !parent.querySelector('.sprite-fallback')) {
                              const span = document.createElement('span');
                              span.className = 'sprite-fallback text-2xl text-ink-500';
                              span.textContent = EQUIP_SLOT_GLYPH[def.slot] ?? '◆';
                              parent.appendChild(span);
                            }
                          }}
                          className="w-full h-full object-contain"
                          style={{ imageRendering: 'pixelated', maxWidth: '90px', maxHeight: '90px' }}
                        />
                        {!isOwned && (
                          <span className="absolute top-1 right-1 text-[8px] font-mono text-ink-400 px-1 py-0.5 bg-bg-900/80 border border-ink-500/30 uppercase tracking-widest pointer-events-none">
                            unowned
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono truncate" style={{ color: RARITY_COLOR[def.rarity] }}>
                        {def.name}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="flex items-center gap-1">
                          <span className="text-[8px] font-mono text-ink-300 uppercase tracking-widest">
                            {RARITY_LABEL[def.rarity]}
                          </span>
                          {/* Class-lock badge — small, class-colored.
                              Only shown when the item is restricted
                              to a specific class so the user can see
                              at a glance which items are for them.
                              `primaryColorForClass` returns a hex via
                              `WORLD_COLOR_HEX[...]` so the CSS color
                              resolves correctly (the previous version
                              passed the bare key name like 'periwinkle'
                              which CSS doesn't recognize — it fell
                              back to the inherited gray). */}
                          {def.classRestriction && (
                            <span
                              className="text-[8px] font-mono uppercase tracking-widest px-1 py-px border"
                              style={{
                                color: WORLD_COLOR_HEX[primaryColorForClass(def.classRestriction)],
                                borderColor: WORLD_COLOR_HEX[primaryColorForClass(def.classRestriction)],
                              }}
                              title={`Class-locked to ${def.classRestriction}`}
                            >
                              {def.classRestriction}
                            </span>
                          )}
                        </span>
                        <span className={classNames(
                          'text-[8px] font-mono',
                          isOwned ? 'text-neon-cyan' : 'text-ink-500',
                        )}>
                          {isOwned ? `${ownedCount}×${equippedCount ? ` (${equippedCount} eq)` : ''}` : '—'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Rolled stats from the equipped loadout. Moved up here
              from the right column — sits between Equipped Loadout
              and Item Catalogue so the user sees the cumulative
              effect of whatever was just equipped before browsing
              for the next item. */}
          <Panel title="STATS FROM EQUIPMENT" variant="amber">
            <div className="space-y-2">
              {Object.keys(totals).length === 0 ? (
                <div className="text-[10px] font-mono text-ink-300 italic">
                  Equip items to see rolled combat stats here.
                </div>
              ) : (
                Object.entries(totals)
                  .sort(([a], [b]) => (STAT_LABEL[a] ?? a).localeCompare(STAT_LABEL[b] ?? b))
                  .map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between border-b border-ink-500/20 pb-1">
                      <span className="text-[10px] font-mono text-ink-200">{STAT_LABEL[key] ?? key}</span>
                      <span className="text-[11px] font-mono text-neon-cyan">{fmtStatValue(key, value)}</span>
                    </div>
                  ))
              )}
              {Object.entries(setCounts).length > 0 && (
                <div className="pt-2 border-t border-ink-500/30">
                  <div className="text-[9px] font-mono text-ink-300 tracking-widest uppercase mb-1">
                    Set pieces
                  </div>
                  {Object.entries(setCounts).map(([setId, count]) => (
                    <div key={setId} className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-ink-200">{setId}</span>
                      <span className="text-neon-magenta">{count}× worn</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Right column: item detail panel only (was: stats + PREVIEW).
            PREVIEW was the class portrait which is on the homebase
            dashboard already, so we drop it here. STATS moved up to
            the left column under the equipped loadout. */}
        <div className="space-y-4">

          {/* Item detail / actions */}
          {selectedDef && (
            <Panel title={selectedDef.name} variant="cyan">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 flex-shrink-0 bg-bg-800/60 border border-ink-500/30 p-1 relative overflow-hidden">
                    <img
                      src={`/sprites/${selectedDef.sprite.endsWith('.png') ? selectedDef.sprite : selectedDef.sprite + '.png'}`}
                      alt={selectedDef.name}
                      width={90}
                      height={90}
                      draggable={false}
                      onError={(e) => {
                        const el = e.currentTarget as HTMLImageElement;
                        el.style.display = 'none';
                        const parent = el.parentElement;
                        if (parent && !parent.querySelector('.sprite-fallback')) {
                          const span = document.createElement('span');
                          span.className = 'sprite-fallback text-xl text-ink-500 flex items-center justify-center w-full h-full';
                          span.textContent = EQUIP_SLOT_GLYPH[selectedDef.slot] ?? '◆';
                          parent.appendChild(span);
                        }
                      }}
                      className="w-full h-full object-contain"
                      style={{ imageRendering: 'pixelated', maxWidth: '90px', maxHeight: '90px' }}
                    />
                  </div>
                  <div className="text-xs">
                    <div className="font-display tracking-widest text-sm" style={{ color: RARITY_COLOR[selectedDef.rarity] }}>
                      {selectedDef.name}
                    </div>
                    <div className="text-[10px] font-mono text-ink-300 mt-0.5">
                      {EQUIP_SLOT_LABEL[selectedDef.slot]} · {RARITY_LABEL[selectedDef.rarity]}
                    </div>
                    {selectedItem ? (
                      <>
                        <div className="text-[10px] font-mono text-ink-300">
                          Acquired {formatRelative(selectedItem.acquiredAt)}
                        </div>
                        <div className="text-[10px] font-mono text-ink-400">
                          {SOURCE_LABEL[selectedItem.source]}
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] font-mono text-neon-magenta italic mt-0.5">
                        Not yet owned — drops come from monsters, bosses, and quests.
                      </div>
                    )}
                  </div>
                </div>

                {Object.keys(selectedDef.stats).length > 0 && (
                  <div className="border-t border-ink-500/30 pt-2">
                    <div className="text-[9px] font-mono text-ink-300 tracking-widest uppercase mb-1">Stats</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                      {Object.entries(selectedDef.stats).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-[10px] font-mono">
                          <span className="text-ink-200">{STAT_LABEL[k] ?? k}</span>
                          <span className="text-neon-cyan">{fmtStatValue(k, v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  {selectedItem ? (
                    selectedItem.equippedSlot ? (
                      <NeonButton
                        size="sm"
                        variant="magenta"
                        onClick={() => unequipM.run(selectedItem.id)}
                        loading={unequipM.isPending}
                        icon="↩"
                        loadingText="Unequipping…"
                      >
                        Unequip
                      </NeonButton>
                    ) : (
                      <NeonButton
                        size="sm"
                        onClick={() => equipM.run(selectedItem.id)}
                        loading={equipM.isPending}
                        icon="⚡"
                        loadingText="Equipping…"
                        disabled={
                          selectedDef.classRestriction != null &&
                          user?.class !== selectedDef.classRestriction
                        }
                        title={
                          selectedDef.classRestriction != null && user?.class !== selectedDef.classRestriction
                            ? `Class lock: ${selectedDef.classRestriction} only`
                            : undefined
                        }
                      >
                        Equip
                      </NeonButton>
                    )
                  ) : (
                    <div className="text-[10px] font-mono text-ink-400 italic">
                      Not yet in your inventory — drops come from monsters and bosses.
                    </div>
                  )}
                </div>

                {selectedDef.classRestriction && user?.class !== selectedDef.classRestriction && (
                  <div className="text-[10px] font-mono text-neon-magenta italic">
                    Locked to {selectedDef.classRestriction}. Switch classes in /profile to equip.
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </Layout>
  );
}