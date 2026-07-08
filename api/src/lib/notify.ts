import { prisma, type NotificationCategory } from './prisma.js';

// ============================================================================
// Notification emit helper.
// ============================================================================
//
// Single funnel for creating Notification rows so every event site
// (level-up, skill unlock, penance, shop purchase, …) writes the same
// shape and we can add cross-cutting behavior (rate-limit, coalesce,
// push) in one place later.
//
// Fire-and-forget by design: a notification is a side effect of a
// primary action (awarding XP, unlocking a skill). If the insert
// fails we must NOT fail the primary action — so callers should not
// await-with-throw. `emitNotification` swallows + logs its own errors
// and always resolves.

export type EmitNotificationInput = {
  userId: string;
  category: NotificationCategory;
  /** Machine-readable event kind, e.g. 'level_up', 'skill_unlock'. */
  kind: string;
  /** One-line summary shown in the inbox row. */
  title: string;
  /** Optional longer body shown when the row is expanded. */
  body?: string | null;
  /** Optional in-app deep link, e.g. '/skills'. */
  link?: string | null;
  /** Optional structured payload (xp, skillId, level, …). */
  payload?: Record<string, unknown> | null;
};

/**
 * Create a Notification row. Never throws — logs and resolves so a
 * notification failure can't roll back the primary action that
 * triggered it.
 */
export async function emitNotification(input: EmitNotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        category: input.category,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        payload: (input.payload ?? undefined) as any,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] failed to emit notification', {
      userId: input.userId,
      kind: input.kind,
      err,
    });
  }
}
