import { PrismaClient, BreachTier, BreachDifficulty, BreachClassAffinity } from '@prisma/client';
import { bossHpForDifficulty } from '../src/lib/breach.js';

const prisma = new PrismaClient();

type BossSeed = {
  name: string;
  lore: string;
  intro: string;
  difficulty: BreachDifficulty;
  tier: BreachTier;
  classAffinity: BreachClassAffinity;
  preferredTags: string[];
  bonusTags?: string[];
  spriteEmoji: string;
  spriteColor: string;
};

const BOSSES: BossSeed[] = [
  // ===== JUGGERNAUT affinity =====
  {
    name: 'The Iron Sarcophagus',
    lore: 'A sealed vault of grinding, oxidized willpower. Its hide is a half-inch of rust and old ambition.',
    intro: 'You feel the floor vibrate. Something heavy is breathing in the dark.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'JUGGERNAUT',
    preferredTags: ['push', 'heavy_compound', 'legs'],
    spriteEmoji: '▣', spriteColor: '#dc2626',
  },
  {
    name: 'Hollow Titan',
    lore: 'Once a god of compound lifts. Now it walks the Breach repeating form without fire.',
    intro: 'Dust falls from the ceiling in perfect time with the Titan\'s slow breath.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'JUGGERNAUT',
    preferredTags: ['heavy_compound', 'legs', 'back'],
    spriteEmoji: '⬣', spriteColor: '#dc2626',
  },
  {
    name: 'Anvilborn Juggernaut',
    lore: 'Forged in the first gym. The chains that bind it are made of old 5x5 plates.',
    intro: 'The clang of iron on iron rings through the Breach — it hears your approach.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'JUGGERNAUT',
    preferredTags: ['heavy_compound', 'legs', 'push'],
    bonusTags: ['marathon_set'],
    spriteEmoji: '◼', spriteColor: '#dc2626',
  },
  {
    name: 'Crimson Mound',
    lore: 'A pile of effort that learned to walk. The veins in its arms glow when it strains.',
    intro: 'The ground shakes. A shape made of unfinished reps rises from the floor.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'JUGGERNAUT',
    preferredTags: ['push', 'legs', 'heavy_compound', 'chest'],
    bonusTags: ['marathon_set', 'one_rm'],
    spriteEmoji: '⏧', spriteColor: '#dc2626',
  },
  {
    name: 'The Last Rep',
    lore: 'It is the final set you didn\'t finish. It will outlive you.',
    intro: 'You feel every muscle you\'ve ever neglected, all at once, before you see it.',
    difficulty: 'FIVE', tier: 'APEX', classAffinity: 'JUGGERNAUT',
    preferredTags: ['heavy_compound', 'push', 'pull', 'legs', 'chest', 'back'],
    bonusTags: ['marathon_set', 'one_rm', 'failure_set'],
    spriteEmoji: '⛞', spriteColor: '#dc2626',
  },

  // ===== BERSERKER affinity =====
  {
    name: 'The Unrested',
    lore: 'A tremor that forgot how to sleep. It paces the Breach, waiting for a body to break.',
    intro: 'You hear footsteps that never quite land. The Unrested has been watching you.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'BERSERKER',
    preferredTags: ['endurance', 'cardio', 'calves'],
    spriteEmoji: '⚊', spriteColor: '#d946ef',
  },
  {
    name: 'Flayed Pace',
    lore: 'Runs on empty. It will outlast anything that breathes in rhythm.',
    intro: 'The air thins. You smell copper and old sweat.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'BERSERKER',
    preferredTags: ['cardio', 'endurance', 'legs'],
    spriteEmoji: '⚋', spriteColor: '#d946ef',
  },
  {
    name: 'The Crimson Howl',
    lore: 'A wolf made of lactic acid. It feeds on the burning in your last set.',
    intro: 'You hear it before you see it. The howl scrapes like a bar across a knurl.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'BERSERKER',
    preferredTags: ['endurance', 'cardio', 'legs', 'back'],
    bonusTags: ['tabata'],
    spriteEmoji: '✦', spriteColor: '#d946ef',
  },
  {
    name: 'Heartstopper Mare',
    lore: 'A horse whose heartbeat is its hooves. You can\'t outrun what doesn\'t stop.',
    intro: 'The ground thuds in fours. Then threes. Then twos. It\'s slowing down for you.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'BERSERKER',
    preferredTags: ['cardio', 'endurance', 'legs', 'calves'],
    bonusTags: ['marathon', 'tabata'],
    spriteEmoji: '♞', spriteColor: '#d946ef',
  },
  {
    name: 'The Empty Tank',
    lore: 'It is the moment your gas runs out, frozen mid-stride. To kill it, finish what it couldn\'t.',
    intro: 'You taste iron. The Tank turns its hollow eyes toward you and inhales nothing.',
    difficulty: 'FIVE', tier: 'APEX', classAffinity: 'BERSERKER',
    preferredTags: ['cardio', 'endurance', 'legs', 'calves', 'full_body'],
    bonusTags: ['marathon', 'tabata', 'sprint'],
    spriteEmoji: '⛬', spriteColor: '#d946ef',
  },

  // ===== PHANTOM affinity =====
  {
    name: 'The Wisp',
    lore: 'It looks like breath on a cold mirror. It knows where you\'ll be before you do.',
    intro: 'The lights flicker. You feel something pass through you like a thought.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'PHANTOM',
    preferredTags: ['pull', 'back', 'biceps'],
    spriteEmoji: '·', spriteColor: '#a3e635',
  },
  {
    name: 'Shrouded Reflex',
    lore: 'A nervous system made of fog. It flinches before you commit.',
    intro: 'You blink and the room has changed. Something has been practicing with your reflexes.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'PHANTOM',
    preferredTags: ['pull', 'back', 'calisthenics'],
    spriteEmoji: '∴', spriteColor: '#a3e635',
  },
  {
    name: 'Glimmerjack',
    lore: 'A pickpocket made of green starlight. It steals tempo, not treasure.',
    intro: 'Your pulse quickens for no reason. The air smells like citrus and static.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'PHANTOM',
    preferredTags: ['pull', 'back', 'biceps', 'calisthenics'],
    bonusTags: ['speed_work'],
    spriteEmoji: '✧', spriteColor: '#a3e635',
  },
  {
    name: 'The Velvet Shadow',
    lore: 'It moves between sets like a held breath. The only sign it\'s there is your own stillness.',
    intro: 'Your shadow looks back at you a half-second late.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'PHANTOM',
    preferredTags: ['pull', 'back', 'biceps', 'calisthenics', 'core'],
    bonusTags: ['speed_work', 'ladder'],
    spriteEmoji: '✦', spriteColor: '#a3e635',
  },
  {
    name: 'The Unseen Clean',
    lore: 'It is the rep you do when no one is watching. To defeat it, do the work in the dark.',
    intro: 'You feel watched. You are. The dark itself is holding a logbook.',
    difficulty: 'FIVE', tier: 'APEX', classAffinity: 'PHANTOM',
    preferredTags: ['pull', 'back', 'biceps', 'core', 'calisthenics', 'bodyweight'],
    bonusTags: ['speed_work', 'ladder', 'isometric'],
    spriteEmoji: '✺', spriteColor: '#a3e635',
  },

  // ===== SCOUT affinity =====
  {
    name: 'The Far Walker',
    lore: 'It has walked the rim of every map. Its boots are worn down to the soul.',
    intro: 'You hear a soft, even footfall that never seems to get closer.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'SCOUT',
    preferredTags: ['cardio', 'endurance', 'hiking'],
    spriteEmoji: '⌖', spriteColor: '#daa520',
  },
  {
    name: 'Trail-Eater',
    lore: 'A path that learned hunger. The more ground you cover, the hungrier it gets.',
    intro: 'The trail you\'re on dips, then climbs. The Trail-Eater is feeding.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'SCOUT',
    preferredTags: ['cardio', 'endurance', 'legs', 'calves'],
    spriteEmoji: '⌗', spriteColor: '#daa520',
  },
  {
    name: 'The Golden Compass',
    lore: 'It always points somewhere you\'ve never been. Following it is the test.',
    intro: 'Your watch vibrates. The needle spins until it finds you.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'SCOUT',
    preferredTags: ['cardio', 'endurance', 'legs', 'full_body'],
    bonusTags: ['trail_run'],
    spriteEmoji: '◈', spriteColor: '#daa520',
  },
  {
    name: 'The Slow Cartographer',
    lore: 'It maps the world by pacing. Every step leaves a yellow stain.',
    intro: 'You find a chalk arrow on the floor. It points back the way you came.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'SCOUT',
    preferredTags: ['cardio', 'endurance', 'legs', 'full_body', 'calves'],
    bonusTags: ['trail_run', 'ruck'],
    spriteEmoji: '⬡', spriteColor: '#daa520',
  },
  {
    name: 'The Long Mile',
    lore: 'It is the last mile of any distance. It stretches to fit your fear.',
    intro: 'Your GPS reads the same number it read a minute ago. The mile knows.',
    difficulty: 'FIVE', tier: 'APEX', classAffinity: 'SCOUT',
    preferredTags: ['cardio', 'endurance', 'legs', 'full_body', 'calves', 'core'],
    bonusTags: ['trail_run', 'ruck', 'marathon'],
    spriteEmoji: '⛛', spriteColor: '#daa520',
  },

  // ===== TRACER affinity =====
  {
    name: 'The Twitch',
    lore: 'A muscle spasm given will. It fires before you think.',
    intro: 'Your eyelid jumps. So does something in the dark.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'TRACER',
    preferredTags: ['cardio', 'endurance', 'sprint'],
    spriteEmoji: '⌁', spriteColor: '#fb923c',
  },
  {
    name: 'Snapback',
    lore: 'It returns to its starting position faster than you can blink.',
    intro: 'You reach for a glass. It\'s already on the floor. Something has your reflexes.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'TRACER',
    preferredTags: ['cardio', 'endurance', 'speed_work'],
    spriteEmoji: '⌇', spriteColor: '#fb923c',
  },
  {
    name: 'The Vermillion Fox',
    lore: 'It moves in diagonals. Approach it straight-on and you\'ll never land a hand.',
    intro: 'You see orange in your peripheral. By the time you turn, it\'s behind you.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'TRACER',
    preferredTags: ['cardio', 'sprint', 'calisthenics', 'speed_work'],
    bonusTags: ['tabata'],
    spriteEmoji: '✱', spriteColor: '#fb923c',
  },
  {
    name: 'The Quantum Step',
    lore: 'It is everywhere it has ever been, all at once. Pick one.',
    intro: 'You see it in two places at once. Then four. You stop counting.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'TRACER',
    preferredTags: ['cardio', 'sprint', 'calisthenics', 'speed_work', 'core'],
    bonusTags: ['tabata', 'ladder'],
    spriteEmoji: '✸', spriteColor: '#fb923c',
  },
  {
    name: 'The Reflex Made Flesh',
    lore: 'It is the millisecond between stimulus and response. Kill it before it kills you.',
    intro: 'You flinch before the door closes. The thing on the other side is faster.',
    difficulty: 'FIVE', tier: 'APEX', classAffinity: 'TRACER',
    preferredTags: ['cardio', 'sprint', 'calisthenics', 'speed_work', 'core', 'endurance'],
    bonusTags: ['tabata', 'ladder', 'agility'],
    spriteEmoji: '✺', spriteColor: '#fb923c',
  },

  // ===== ORACLE affinity =====
  {
    name: 'The Quiet Node',
    lore: 'A brain in a jar that hums in the frequency of muscle growth.',
    intro: 'You hear a low hum. The room smells like old textbooks and ozone.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'ORACLE',
    preferredTags: ['mobility', 'flexibility', 'recovery'],
    spriteEmoji: '◌', spriteColor: '#818cf8',
  },
  {
    name: 'The Recursive Loop',
    lore: 'A thought that learned to lift. It cycles the same plateau forever.',
    intro: 'You notice you\'ve done this same workout before. The Loop has been waiting.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ORACLE',
    preferredTags: ['mobility', 'core', 'bodyweight'],
    spriteEmoji: '⊙', spriteColor: '#818cf8',
  },
  {
    name: 'The Probability Witch',
    lore: 'It bends recovery curves. Rest one day more and she gets stronger.',
    intro: 'Your sleep tracker shows perfect numbers. Something is in the data.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ORACLE',
    preferredTags: ['mobility', 'core', 'recovery', 'flexibility'],
    bonusTags: ['breathwork'],
    spriteEmoji: '✺', spriteColor: '#818cf8',
  },
  {
    name: 'The Sleepwalker',
    lore: 'A mind that lifts while you dream. Wake up and your PRs are gone.',
    intro: 'You feel rested in a way that worries you. The Sleepwalker has been working.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'ORACLE',
    preferredTags: ['mobility', 'core', 'recovery', 'flexibility', 'full_body'],
    bonusTags: ['breathwork', 'isometric'],
    spriteEmoji: '⌘', spriteColor: '#818cf8',
  },
  {
    name: 'The Pattern Prophet',
    lore: 'It has read your training log and predicted your next plateau. Break the pattern.',
    intro: 'You open your app and the next workout is already written. It is wrong on purpose.',
    difficulty: 'FIVE', tier: 'APEX', classAffinity: 'ORACLE',
    preferredTags: ['mobility', 'core', 'recovery', 'flexibility', 'full_body', 'bodyweight'],
    bonusTags: ['breathwork', 'isometric', 'meditation'],
    spriteEmoji: '☯', spriteColor: '#818cf8',
  },

  // ===== ANY affinity — variety =====
  {
    name: 'The Unfinished Program',
    lore: 'A workout that was abandoned at week 3. It begs to be completed.',
    intro: 'You find a printout of an old program. Half the sets are filled in.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['strength', 'hypertrophy'],
    spriteEmoji: '☐', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Foam Famine',
    lore: 'It is the smell of a gym bag left in a hot car. It hungers.',
    intro: 'The air thickens. You remember every recovery day you skipped.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['mobility', 'recovery', 'flexibility'],
    spriteEmoji: '▢', spriteColor: '#a8a8b8',
  },
  {
    name: 'The P.R. Thief',
    lore: 'It steals your records one kilo at a time. Catch it before the year ends.',
    intro: 'Your old maxes feel lighter. Something has been lifting them.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ANY',
    preferredTags: ['heavy_compound', 'strength'],
    bonusTags: ['one_rm'],
    spriteEmoji: '◭', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Echo Bench',
    lore: 'It is every failed lift you\'ve ever bounced out of. They\'re all waiting.',
    intro: 'You hear a familiar spotter count. The count is wrong.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['push', 'chest', 'triceps'],
    spriteEmoji: '◬', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Squat Rack Wraith',
    lore: 'A rack that lets you down an inch at a time. It has been training you.',
    intro: 'You set the safeties. They\'re lower than you remember.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['legs', 'push', 'heavy_compound'],
    spriteEmoji: '⌸', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Pullup Procrastinator',
    lore: 'It is every kipping rep you\'ve ever called strict. It knows.',
    intro: 'You grab the bar. The bar swings back. The Procrastinator laughs in swings.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['pull', 'bodyweight', 'calisthenics'],
    spriteEmoji: '⌹', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Cardio Conspiracy',
    lore: 'A conspiracy of treadmills. They plan together. They\'re patient.',
    intro: 'All the treadmills are at the same incline. None are running.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ANY',
    preferredTags: ['cardio', 'endurance'],
    bonusTags: ['zone_2'],
    spriteEmoji: '⌽', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Spotter of Doubt',
    lore: 'It stands behind you on every heavy set and whispers "you\'ll fail this one."',
    intro: 'You feel watched. The Spotter is already counting your reps in a sad voice.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ANY',
    preferredTags: ['heavy_compound', 'strength', 'push', 'pull'],
    bonusTags: ['failure_set'],
    spriteEmoji: '⌼', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Stale Cycle',
    lore: 'A workout that never changes. It has been your only program for six months.',
    intro: 'You reach for the same weight you\'ve always reached for. The Cycle smiles.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['hypertrophy', 'strength'],
    spriteEmoji: '↻', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Gremlin of Form',
    lore: 'It perches on your elbow during curls. It makes them swing.',
    intro: 'Your form feels fine. The Gremlin disagrees.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['pull', 'biceps'],
    spriteEmoji: '⏛', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Plateau King',
    lore: 'It is the 4-week stall. It feeds on sameness.',
    intro: 'Your numbers look exactly like last month. The Plateau King is well-fed.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'ANY',
    preferredTags: ['strength', 'hypertrophy', 'heavy_compound'],
    bonusTags: ['deload'],
    spriteEmoji: '♔', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Momentum Witch',
    lore: 'She rides the bar and adds 10 invisible kilos. Drop the bar, drop her.',
    intro: 'You feel the bar carry you. The Witch is helping. It hurts to use her.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ANY',
    preferredTags: ['strength', 'heavy_compound'],
    bonusTags: ['one_rm'],
    spriteEmoji: '♕', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Old You',
    lore: 'A mirror that shows you last year\'s body. Fight it into next year\'s.',
    intro: 'You catch a glimpse of yourself in the rack. The reflection moves a second slow.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'ANY',
    preferredTags: ['hypertrophy', 'strength', 'bodyweight'],
    bonusTags: ['progressive_overload'],
    spriteEmoji: '♖', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Grocery Store Lich',
    lore: 'A monster that grows fat on your meal prep gaps. Catch it on a Tuesday.',
    intro: 'You see it in the chip aisle. It sees you in the produce section.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['cardio', 'endurance', 'core'],
    spriteEmoji: '☠', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Screen Burner',
    lore: 'A screen that melts your standing desk hours. Defeat it by stepping away.',
    intro: 'Your watch buzzes. You\'ve taken 412 steps. The Burner grins in standby.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['cardio', 'mobility', 'recovery'],
    spriteEmoji: '▢', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Recovery Debt Collector',
    lore: 'It sends notices for every skipped sleep. It accepts compound interest in reps.',
    intro: 'Your watch reads 4 hours. The Collector arrives with paperwork.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ANY',
    preferredTags: ['recovery', 'mobility', 'flexibility'],
    bonusTags: ['sleep_recovery'],
    spriteEmoji: '⚖', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Stack Phantom',
    lore: 'It is every supplement you bought and never took. They haunt the cupboard.',
    intro: 'You open a cabinet. Five jars of pre-workout stare back.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['endurance', 'cardio', 'recovery'],
    spriteEmoji: '⚗', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Gym Ghost',
    lore: 'A locker that holds your old water bottle. It is still half full.',
    intro: 'You find your old gym bag in the back of the closet. It has been waiting.',
    difficulty: 'ONE', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['cardio', 'endurance', 'mobility'],
    spriteEmoji: '👻', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Tempo Tyrant',
    lore: 'He counts seconds between reps. Every tempo skip feeds him.',
    intro: 'You rush a rep. The Tyrant\'s eyebrow rises.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['strength', 'hypertrophy', 'isometric'],
    bonusTags: ['tempo_work'],
    spriteEmoji: '♚', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Volume Vampire',
    lore: 'It drinks your rest periods. Keep the clock honest or feed it forever.',
    intro: 'You check your phone between sets. The Vampire has been watching.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['hypertrophy', 'strength'],
    spriteEmoji: '🧛', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Heartrate Hollow',
    lore: 'It is the moment your heart forgets why it\'s racing. Reset the rate.',
    intro: 'Your pulse plateaus mid-set. The Hollow is sitting on the line.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ANY',
    preferredTags: ['cardio', 'endurance', 'sprint'],
    bonusTags: ['zone_2', 'zone_4'],
    spriteEmoji: '♥', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Form Checker',
    lore: 'A being made of all your coaching notes. It judges your setup.',
    intro: 'You feel your brace slip. The Form Checker\'s pen scratches red.',
    difficulty: 'FOUR', tier: 'LEGENDARY', classAffinity: 'ANY',
    preferredTags: ['heavy_compound', 'strength', 'core'],
    bonusTags: ['form_focus'],
    spriteEmoji: '⚖', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Progression Lich',
    lore: 'It guards the next rung of your program. It only falls to a perfect week.',
    intro: 'You see a ladder. The Lich is at the top, holding the next rung.',
    difficulty: 'FIVE', tier: 'APEX', classAffinity: 'ANY',
    preferredTags: ['heavy_compound', 'strength', 'push', 'pull', 'legs', 'core'],
    bonusTags: ['progressive_overload', 'one_rm', 'failure_set'],
    spriteEmoji: '☠', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Breaker of Streaks',
    lore: 'It smiles when you miss a day. One slip and it\'s at your door.',
    intro: 'Your calendar shows a gap. The Breaker has been waiting.',
    difficulty: 'TWO', tier: 'MINOR', classAffinity: 'ANY',
    preferredTags: ['strength', 'cardio', 'endurance'],
    spriteEmoji: '✗', spriteColor: '#a8a8b8',
  },
  {
    name: 'The Half-Rep Hydra',
    lore: 'Cut one short rep off and two more grow back. Full ROM or it multiplies.',
    intro: 'You cut a curl short. Two more half-reps rise behind it.',
    difficulty: 'THREE', tier: 'ELITE', classAffinity: 'ANY',
    preferredTags: ['hypertrophy', 'biceps', 'triceps'],
    spriteEmoji: '🐉', spriteColor: '#a8a8b8',
  },
];

async function main() {
  console.log(`Seeding ${BOSSES.length} Breach bosses…`);
  for (const b of BOSSES) {
    const existing = await prisma.breachBoss.findFirst({ where: { name: b.name } });
    const data = {
      name: b.name,
      lore: b.lore,
      intro: b.intro,
      difficulty: b.difficulty,
      tier: b.tier,
      maxHp: bossHpForDifficulty(b.difficulty),
      hp: bossHpForDifficulty(b.difficulty),
      classAffinity: b.classAffinity,
      preferredTags: b.preferredTags,
      bonusTags: b.bonusTags || [],
      spriteEmoji: b.spriteEmoji,
      spriteColor: b.spriteColor,
    };
    if (existing) {
      await prisma.breachBoss.update({ where: { id: existing.id }, data });
    } else {
      await prisma.breachBoss.create({ data });
    }
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
