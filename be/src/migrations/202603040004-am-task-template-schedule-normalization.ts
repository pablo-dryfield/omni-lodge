import type { QueryInterface, Transaction } from 'sequelize';
import { QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_TEMPLATES = 'am_task_templates';

type ScheduleUpdate = {
  name: string;
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
};

const SCHEDULE_UPDATES: ScheduleUpdate[] = [
  {
    name: 'Daily - Social story',
    previous: {
      time: '12:00',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['social', 'marketing', 'story'],
      requireShift: false,
    },
    next: {
      time: '11:15',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['social', 'marketing', 'story'],
      requireShift: false,
    },
  },
  {
    name: 'Daily - Check booking numbers',
    previous: {
      time: '13:00',
      durationHours: 0.5,
      priority: 'high',
      points: 2,
      tags: ['bookings', 'operations'],
      requireShift: false,
    },
    next: {
      time: '11:45',
      durationHours: 0.5,
      priority: 'high',
      points: 2,
      tags: ['bookings', 'operations'],
      requireShift: false,
    },
  },
  {
    name: 'Daily - Prepare WhatsApp group',
    previous: {
      time: '16:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['whatsapp', 'operations'],
      requireShift: true,
    },
    next: {
      time: '14:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['whatsapp', 'operations'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Photo workflow and Facebook album',
    previous: {
      time: '11:00',
      durationHours: 2,
      priority: 'medium',
      points: 3,
      tags: ['photos', 'lightroom', 'google-drive', 'facebook'],
      requireShift: false,
    },
    next: {
      time: '09:00',
      durationHours: 2,
      priority: 'medium',
      points: 3,
      tags: ['photos', 'lightroom', 'google-drive', 'facebook'],
      requireShift: false,
    },
  },
  {
    name: 'Daily - Rejoin message to previous day group',
    previous: {
      time: '14:00',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['whatsapp', 'retention'],
      requireShift: false,
    },
    next: {
      time: '12:30',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['whatsapp', 'retention'],
      requireShift: false,
    },
  },
  {
    name: 'Daily - Send picture link to previous day group',
    previous: {
      time: '14:15',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['whatsapp', 'photos', 'facebook'],
      requireShift: false,
    },
    next: {
      time: '12:45',
      durationHours: 0.25,
      priority: 'medium',
      points: 1,
      tags: ['whatsapp', 'photos', 'facebook'],
      requireShift: false,
    },
  },
  {
    name: 'Daily - Charge camera and lights',
    previous: {
      time: '18:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['equipment', 'camera'],
      requireShift: true,
    },
    next: {
      time: '17:15',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['equipment', 'camera'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Prepare wristbands',
    previous: {
      time: '18:00',
      durationHours: 0.5,
      priority: 'high',
      points: 2,
      tags: ['wristbands', 'operations'],
      requireShift: true,
    },
    next: {
      time: '17:30',
      durationHours: 0.5,
      priority: 'high',
      points: 2,
      tags: ['wristbands', 'operations'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Prepare booking add-ons',
    previous: {
      time: '18:10',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['addons', 'operations'],
      requireShift: true,
    },
    next: {
      time: '18:00',
      durationHours: 0.25,
      priority: 'high',
      points: 2,
      tags: ['addons', 'operations'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Monitor KTK Promotion chat',
    previous: {
      time: '20:30',
      durationHours: 2,
      priority: 'high',
      points: 3,
      tags: ['promotion', 'staff'],
      requireShift: true,
    },
    next: {
      time: '20:15',
      durationHours: 0.5,
      priority: 'high',
      points: 3,
      tags: ['promotion', 'staff'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Supervise night and take photos',
    previous: {
      time: '21:00',
      durationHours: 4,
      priority: 'high',
      points: 4,
      tags: ['operations', 'camera', 'night'],
      requireShift: true,
    },
    next: {
      time: '21:45',
      durationHours: 1.5,
      priority: 'high',
      points: 4,
      tags: ['operations', 'camera', 'night'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Deliver city rules flyers',
    previous: {
      time: '21:00',
      durationHours: 0.5,
      priority: 'high',
      points: 3,
      tags: ['city-rules', 'guests'],
      requireShift: true,
    },
    next: {
      time: '21:15',
      durationHours: 0.5,
      priority: 'high',
      points: 3,
      tags: ['city-rules', 'guests'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Review KTK House Cleaning photos',
    previous: {
      time: '15:00',
      durationHours: 0.5,
      priority: 'medium',
      points: 2,
      tags: ['cleaning', 'staff'],
      requireShift: false,
    },
    next: {
      time: '13:15',
      durationHours: 0.5,
      priority: 'medium',
      points: 2,
      tags: ['cleaning', 'staff'],
      requireShift: false,
    },
  },
  {
    name: 'Daily - Enforce city rules during the night',
    previous: {
      time: '21:00',
      durationHours: 3,
      priority: 'high',
      points: 3,
      tags: ['city-rules', 'night'],
      requireShift: true,
    },
    next: {
      time: '23:15',
      durationHours: 0.5,
      priority: 'high',
      points: 3,
      tags: ['city-rules', 'night'],
      requireShift: true,
    },
  },
  {
    name: 'Daily - Monitor staff and guest condition',
    previous: {
      time: '21:00',
      durationHours: 3,
      priority: 'high',
      points: 4,
      tags: ['safety', 'staff', 'guests'],
      requireShift: true,
    },
    next: {
      time: '23:45',
      durationHours: 0.5,
      priority: 'high',
      points: 4,
      tags: ['safety', 'staff', 'guests'],
      requireShift: true,
    },
  },
  {
    name: 'Weekly - IG and TikTok posts',
    previous: {
      daysOfWeek: [1, 4],
      time: '12:00',
      durationHours: 0.75,
      priority: 'medium',
      points: 2,
      tags: ['social', 'instagram', 'tiktok'],
      requireShift: false,
    },
    next: {
      daysOfWeek: [1, 4],
      time: '15:00',
      durationHours: 0.75,
      priority: 'medium',
      points: 2,
      tags: ['social', 'instagram', 'tiktok'],
      requireShift: false,
    },
  },
  {
    name: 'Weekly - Secretly review volunteer promotion',
    previous: {
      daysOfWeek: [3],
      time: '16:00',
      durationHours: 0.5,
      priority: 'medium',
      points: 2,
      tags: ['volunteers', 'promotion'],
      requireShift: false,
    },
    next: {
      daysOfWeek: [3],
      time: '15:00',
      durationHours: 0.5,
      priority: 'medium',
      points: 2,
      tags: ['volunteers', 'promotion'],
      requireShift: false,
    },
  },
  {
    name: 'Weekly - Content planning meeting',
    previous: {
      daysOfWeek: [1],
      time: '11:00',
      durationHours: 1,
      priority: 'medium',
      points: 2,
      tags: ['content', 'meeting'],
      requireShift: false,
    },
    next: {
      daysOfWeek: [1],
      time: '08:00',
      durationHours: 1,
      priority: 'medium',
      points: 2,
      tags: ['content', 'meeting'],
      requireShift: false,
    },
  },
  {
    name: 'Weekly - Buy staff supplies',
    previous: {
      daysOfWeek: [1],
      time: '15:00',
      durationHours: 1,
      priority: 'medium',
      points: 2,
      tags: ['supplies', 'staff'],
      requireShift: true,
    },
    next: {
      daysOfWeek: [1],
      time: '16:00',
      durationHours: 1,
      priority: 'medium',
      points: 2,
      tags: ['supplies', 'staff'],
      requireShift: true,
    },
  },
];

const applyScheduleUpdates = async (
  qi: QueryInterface,
  transaction: Transaction,
  key: 'previous' | 'next',
) => {
  for (const update of SCHEDULE_UPDATES) {
    await qi.sequelize.query(
      `
      UPDATE ${TABLE_TEMPLATES}
      SET schedule_config = CAST(:scheduleConfig AS jsonb),
          updated_at = NOW()
      WHERE name = :name;
      `,
      {
        transaction,
        type: QueryTypes.UPDATE,
        replacements: {
          name: update.name,
          scheduleConfig: JSON.stringify(update[key]),
        },
      },
    );
  }
};

export const up = async ({ context: qi }: MigrationParams): Promise<void> => {
  await qi.sequelize.transaction(async (transaction) => {
    await applyScheduleUpdates(qi, transaction, 'next');
  });
};

export const down = async ({ context: qi }: MigrationParams): Promise<void> => {
  await qi.sequelize.transaction(async (transaction) => {
    await applyScheduleUpdates(qi, transaction, 'previous');
  });
};
