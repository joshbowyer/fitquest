import { Avatar, type AvatarProps } from './Avatar';

// =============================================================================
// EquippedAvatar — thin re-export of Avatar. The old version layered
// gear sprites on top of the disc; that's gone now. We keep this
// module so call sites in /quest, /dashboard, etc. don't have to be
// rewritten. The disc renders the archetype + class stripe and
// that's it — gear icons live next to it, not inside it.
// =============================================================================

export function EquippedAvatar(props: AvatarProps) {
  return <Avatar {...props} />;
}
