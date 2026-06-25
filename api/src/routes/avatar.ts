import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HairStyle } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

const AvatarSchema = z.object({
  hairStyle: z.nativeEnum(HairStyle).optional(),
  hairColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  skinTone: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  shirtColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  pantsColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function avatarRoutes(app: FastifyInstance) {
  // GET /avatar — fetch the user's customization, creating default if
  // missing.
  app.get('/', async (req) => {
    const me = await requireUser(req);
    let avatar = await prisma.avatar.findUnique({ where: { userId: me.id } });
    if (!avatar) {
      avatar = await prisma.avatar.create({ data: { userId: me.id } });
    }
    return { avatar };
  });

  // PUT /avatar — upsert customization.
  app.put('/', async (req) => {
    const me = await requireUser(req);
    const body = AvatarSchema.parse(req.body);
    const avatar = await prisma.avatar.upsert({
      where: { userId: me.id },
      create: { userId: me.id, ...body },
      update: body,
    });
    return { avatar };
  });
}
