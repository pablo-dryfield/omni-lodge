import { Op, Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import Page from '../models/Page.js';
import RolePagePermission from '../models/RolePagePermission.js';
import UserType from '../models/UserType.js';
import { runSeedOnce } from '../services/seedRunService.js';

const MAINTENANCE_PAGE = {
  slug: 'settings-maintenance',
  name: 'Maintenance',
  description: 'Review seeds, migrations, and configuration health',
  sortOrder: 25,
  status: true,
};

const MAINTENANCE_SEED_KEY = 'access-control-maintenance-v1';

export const seedMaintenanceAccess = async (actorId?: number | null) =>
  runSeedOnce({
    seedKey: MAINTENANCE_SEED_KEY,
    runType: 'sync',
    actorId: actorId ?? null,
    run: async () => {
      let pageCreated = false;
      let pageUpdated = false;
      let permissionCreated = 0;
      let permissionUpdated = 0;

      await sequelize.transaction(async (transaction: Transaction) => {
        const [page, created] = await Page.findOrCreate({
          where: { slug: MAINTENANCE_PAGE.slug },
          defaults: {
            name: MAINTENANCE_PAGE.name,
            description: MAINTENANCE_PAGE.description,
            sortOrder: MAINTENANCE_PAGE.sortOrder,
            status: MAINTENANCE_PAGE.status,
            createdBy: actorId ?? null,
            updatedBy: actorId ?? null,
          },
          transaction,
        });

        pageCreated = created;
        if (!created) {
          const needsUpdate =
            page.name !== MAINTENANCE_PAGE.name ||
            page.description !== MAINTENANCE_PAGE.description ||
            page.sortOrder !== MAINTENANCE_PAGE.sortOrder ||
            page.status !== MAINTENANCE_PAGE.status;
          if (needsUpdate) {
            await page.update(
              {
                name: MAINTENANCE_PAGE.name,
                description: MAINTENANCE_PAGE.description,
                sortOrder: MAINTENANCE_PAGE.sortOrder,
                status: MAINTENANCE_PAGE.status,
                updatedBy: actorId ?? null,
              },
              { transaction },
            );
            pageUpdated = true;
          }
        }

        const roles = await UserType.findAll({
          where: {
            slug: {
              [Op.in]: ['admin', 'administrator'],
            },
          },
          transaction,
        });

        for (const role of roles) {
          const [record, createdPermission] = await RolePagePermission.findOrCreate({
            where: { userTypeId: role.id, pageId: page.id },
            defaults: {
              userTypeId: role.id,
              pageId: page.id,
              canView: true,
              status: true,
              createdBy: actorId ?? null,
              updatedBy: actorId ?? null,
            },
            transaction,
          });

          if (createdPermission) {
            permissionCreated += 1;
          } else {
            await record.update(
              {
                canView: true,
                status: true,
                updatedBy: actorId ?? null,
              },
              { transaction },
            );
            permissionUpdated += 1;
          }
        }
      });

      const seededCount = (pageCreated ? 1 : 0) + permissionCreated;
      return {
        seededCount,
        details: {
          pageCreated,
          pageUpdated,
          permissionCreated,
          permissionUpdated,
        },
      };
    },
  });
