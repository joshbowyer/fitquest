import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { SpriteAvatar } from '@/components/SpriteAvatar';
import { useAuth, type UserAvatar } from '@/lib/auth';
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
import { getFrameArchetype } from '@/lib/frame';
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
  const archetype = useMemo(() => {
    if (!user) return 'SPRITE' as const;
    return getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct) ?? 'SPRITE';
  }, [user]);

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
  // Pull saved avatar customization so the preview matches the
  // user's chosen hair / skin / shirt colors.
  const avatarQ = useQuery({
    queryKey: ['avatar'],
    queryFn: () => api<{ avatar: UserAvatar }>('/avatar'),
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

  const grantM = useDelayedMutation({
    mutationFn: (itemDefId: string) =>
      api<{ item: InventoryItem }>('/inventory/grant', {
        method: 'POST',
        body: { itemDefId, source: 'STARTER_KIT' },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  }, 800);

  const items = invQ.data?.items ?? [];
  const equipped = invQ.data?.equipped ?? ({} as Record<EquipSlot, InventoryItem | null>);
  const totals = statsQ.data?.totals ?? {};
  const setCounts = statsQ.data?.setCounts ?? {};

  // Compute derived: which sprites are currently equipped?
  const equippedWeapon = equipped.MAIN?.itemDef.sprite ?? null;
  const equippedShield = equipped.OFF?.itemDef.sprite ?? null;

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
          {/* Equipped loadout */}
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
                        : 'border-ink-500/30 bg-bg-900/40 cursor-default',
                    )}
                    title={it ? `${EQUIP_SLOT_LABEL[slot]}: ${it.itemDef.name}` : `${EQUIP_SLOT_LABEL[slot]} (empty)`}
                  >
                    <span className="text-[10px] font-mono text-ink-300 tracking-widest uppercase">
                      {EQUIP_SLOT_LABEL[slot]}
                    </span>
                    <span className="text-2xl my-1" style={{ color: it ? RARITY_COLOR[it.itemDef.rarity] : '#585868' }}>
                      {EQUIP_SLOT_GLYPH[slot]}
                    </span>
                    <span className="text-[9px] font-mono text-center truncate w-full" style={{ color: it ? RARITY_COLOR[it.itemDef.rarity] : '#585868' }}>
                      {it ? it.itemDef.name : '—'}
                    </span>
                  </button>
                );
              })}
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
                              at a glance which items are for them. */}
                          {def.classRestriction && (
                            <span
                              className="text-[8px] font-mono uppercase tracking-widest px-1 py-px border"
                              style={{
                                color: primaryColorForClass(def.classRestriction),
                                borderColor: primaryColorForClass(def.classRestriction),
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
        </div>

        {/* Right column: avatar preview + stats panel */}
        <div className="space-y-4">
          <Panel title="PREVIEW" variant="cyan">
            <div className="flex flex-col items-center">
              <div className="flex flex-col items-center">
                {/* Class portrait — the new tron-style full-body
                    sprite. Always shown as the primary preview. */}
                <img
                  src={`/sprites/class-portraits/${(user.class || 'PHANTOM').toLowerCase()}.png`}
                  alt={user.class || 'class portrait'}
                  width={180}
                  height={180}
                  className="block"
                  style={{
                    width: 180,
                    height: 180,
                    filter: `drop-shadow(0 0 12px ${user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : '#14d6e8'}88)`,
                    imageRendering: 'pixelated',
                  }}
                />
                {/* Small SpriteAvatar in the corner shows the
                    layered sprite system (hair / skin / shirt / weapon)
                    with whatever is currently equipped. Toggles when
                    you equip different items so you can see the
                    layered system react to your changes. */}
                <div className="mt-2 flex items-center gap-2">
                  <SpriteAvatar
                    archetype={archetype}
                    hairStyle={avatarQ.data?.avatar.hairStyle ?? 'SHORT'}
                    hairColor={avatarQ.data?.avatar.hairColor ?? '#6b4226'}
                    shirtColor={avatarQ.data?.avatar.shirtColor ?? '#14d6e8'}
                    skinTone={avatarQ.data?.avatar.skinTone ?? '#915533'}
                    weapon={equippedWeapon}
                    shield={equippedShield}
                    size={64}
                  />
                  <div className="text-[9px] font-mono">
                    <div className="text-ink-300 uppercase tracking-widest">equipped</div>
                    <div className="text-ink-500 text-[8px]">layered sprite system</div>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-ink-300 mt-2 uppercase tracking-widest">
                  Live preview reflects equipped gear
                </div>
                {!avatarQ.data && (
                  <div className="text-[9px] font-mono text-ink-400 mt-1 italic">
                    (using defaults — save avatar in /profile to customize)
                  </div>
                )}
              </div>
              </div>
          </Panel>

          {/* Rolled stats */}
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
                    <NeonButton
                      size="sm"
                      variant="violet"
                      onClick={() => grantM.run(selectedDef.id)}
                      loading={grantM.isPending}
                      icon="+"
                      loadingText="Granting…"
                    >
                      Grant (dev)
                    </NeonButton>
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

          {/* Dev helper: grant a starter kit */}
          <Panel title="DEV: STARTER KIT" variant="violet">
            <div className="space-y-2">
              <div className="text-[10px] font-mono text-ink-300">
                Grant a starter item for testing. Real drops come from monsters/bosses (Phase D).
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'shirt_starter_universal',
                  'weapon_warrior_1',
                  'shield_warrior_1',
                  'ring_iron_band',
                  'neck_amber',
                  'head_basic_hood',
                ].map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => grantM.run(id)}
                    disabled={grantM.isPending}
                    className="px-2 py-1 text-[9px] font-mono border border-ink-500/40 hover:border-neon-violet text-ink-200 hover:text-neon-violet"
                  >
                    + {id}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </Layout>
  );
}