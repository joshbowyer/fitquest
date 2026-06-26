import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar, type AvatarProps } from './Avatar';
import type { EquipSlot } from '@/lib/types';

// =============================================================================
// EquippedAvatar — wrapper that fetches the user's equipped items
// from /inventory and forwards each item's sprite path to the
// <Avatar> component. Renders plain <Avatar> with no equipped
// sprite props while the inventory is loading so the page never
// sits on a missing-data state.
//
// This is the right component to use in the dashboard, quest map,
// status, etc. — it always shows whatever the user has equipped
// without the parent having to wire inventory queries in 4+ places.
// =============================================================================

type Equipped = Partial<Record<EquipSlot, { itemDef: { sprite?: string | null } } | null>>;

export function EquippedAvatar(props: Omit<AvatarProps, 'head' | 'body' | 'hands' | 'feet' | 'neck' | 'ring'>) {
  const q = useQuery({
    queryKey: ['inventory', 'equipped'],
    queryFn: () => api<{ equipped: Equipped }>('/inventory'),
    staleTime: 60_000,
  });
  const equipped = q.data?.equipped ?? {};
  return (
    <Avatar
      {...props}
      head={equipped.HEAD?.itemDef.sprite ?? undefined}
      body={equipped.BODY?.itemDef.sprite ?? undefined}
      hands={equipped.HANDS?.itemDef.sprite ?? undefined}
      feet={equipped.FEET?.itemDef.sprite ?? undefined}
      neck={equipped.NECK?.itemDef.sprite ?? undefined}
      ring={equipped.RING?.itemDef.sprite ?? undefined}
    />
  );
}