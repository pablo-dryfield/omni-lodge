import type { QueryInterface } from 'sequelize';
import { QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const CHANNELS = [
    { name: 'Fareharbor', description: 'Fareharbor bookings' },
    { name: 'Viator', description: 'Viator bookings' },
    { name: 'GetYourGuide', description: 'GetYourGuide bookings' },
    { name: 'FreeTour', description: 'FreeTour bookings' },
    { name: 'Walk-In', description: 'Walk-in guests' },
    { name: 'Ecwid', description: 'Ecwid online store' },
    { name: 'Email', description: 'Email reservations' },
    { name: 'Hostel Atlantis', description: 'Hostel Atlantis partners' },
    { name: 'XperiencePoland', description: 'XperiencePoland partners' },
    { name: 'TopDeck', description: 'TopDeck partners' },
];
const ADDONS = [
    { name: 'Cocktails' },
    { name: 'T-Shirts' },
    { name: 'Photos' },
];
const PRODUCT_NAME = 'Pub Crawl';
const PRODUCT_ADDONS = [
    { addonName: 'Cocktails', maxPerAttendee: 1, sortOrder: 0 },
    { addonName: 'T-Shirts', maxPerAttendee: null, sortOrder: 1 },
    { addonName: 'Photos', maxPerAttendee: null, sortOrder: 2 },
];
export async function up({ context }: MigrationParams): Promise<void> {
    const qi = context;
    const transaction = await qi.sequelize.transaction();
    try {
        const channelIds: number[] = [];
        const addonIds = new Map<string, number>();
        for (const channel of CHANNELS) {
            const existingChannelRows = (await qi.sequelize.query(
                'SELECT id FROM channels WHERE LOWER(name) = LOWER(:name) LIMIT 1',
                { replacements: { name: channel.name }, type: QueryTypes.SELECT, transaction },
            )) as Array<{ id: number }>;
            const now = new Date();
            const apiKey = channel.name.replace(/\s+/g, '-').toLowerCase();
            const apiSecret = `${apiKey}-secret`;
            if (existingChannelRows.length > 0) {
                const channelId = existingChannelRows[0].id;
                await qi.sequelize.query(`UPDATE channels
           SET name = :name,
               description = :description,
               apiKey = :apiKey,
               apiSecret = :apiSecret,
               updatedAt = :updatedAt
           WHERE id = :id`, {
                    replacements: {
                        id: channelId,
                        name: channel.name,
                        description: channel.description,
                        apiKey,
                        apiSecret,
                        updatedAt: now,
                    },
                    type: QueryTypes.UPDATE,
                    transaction,
                });
                channelIds.push(channelId);
            }
            else {
                await qi.bulkInsert('channels', [
                    {
                        name: channel.name,
                        description: channel.description,
                        apiKey,
                        apiSecret,
                        createdAt: now,
                        updatedAt: now,
                        createdBy: 1,
                        updatedBy: 1,
                    },
                ], { transaction });
                const insertedChannelRows = (await qi.sequelize.query(
                    'SELECT id FROM channels WHERE LOWER(name) = LOWER(:name) ORDER BY id DESC LIMIT 1',
                    { replacements: { name: channel.name }, type: QueryTypes.SELECT, transaction },
                )) as Array<{ id: number }>;
                if (insertedChannelRows.length > 0) {
                    channelIds.push(insertedChannelRows[0].id);
                }
            }
        }
        for (const addon of ADDONS) {
            const existingAddonRows = (await qi.sequelize.query(
                'SELECT id FROM addons WHERE LOWER(name) = LOWER(:name) LIMIT 1',
                { replacements: { name: addon.name }, type: QueryTypes.SELECT, transaction },
            )) as Array<{ id: number }>;
            const now = new Date();
            if (existingAddonRows.length > 0) {
                const addonId = existingAddonRows[0].id;
                await qi.sequelize.query(`UPDATE addons
           SET is_active = true,
               updatedAt = :updatedAt
           WHERE id = :id`, {
                    replacements: {
                        id: addonId,
                        updatedAt: now,
                    },
                    type: QueryTypes.UPDATE,
                    transaction,
                });
                addonIds.set(addon.name, addonId);
            }
            else {
                await qi.bulkInsert('addons', [
                    {
                        name: addon.name,
                        base_price: null,
                        tax_rate: null,
                        is_active: true,
                        createdAt: now,
                        updatedAt: now,
                    },
                ], { transaction });
                const insertedAddonRows = (await qi.sequelize.query(
                    'SELECT id FROM addons WHERE LOWER(name) = LOWER(:name) ORDER BY id DESC LIMIT 1',
                    { replacements: { name: addon.name }, type: QueryTypes.SELECT, transaction },
                )) as Array<{ id: number }>;
                if (insertedAddonRows.length > 0) {
                    addonIds.set(addon.name, insertedAddonRows[0].id);
                }
            }
        }
        const productMetaRows = (await qi.sequelize.query(
            'SELECT product_type_id as "productTypeId", created_by as "createdBy" FROM products ORDER BY id ASC LIMIT 1',
            { type: QueryTypes.SELECT, transaction },
        )) as Array<{ productTypeId?: number; createdBy?: number }>;
        const defaultProductTypeId = productMetaRows[0]?.productTypeId ?? 1;
        const defaultCreatedBy = productMetaRows[0]?.createdBy ?? 1;
        await qi.sequelize.query('UPDATE products SET status = false WHERE LOWER(name) <> LOWER(:name)', { replacements: { name: PRODUCT_NAME }, type: QueryTypes.UPDATE, transaction });
        const existingProductRows = (await qi.sequelize.query(
            'SELECT id FROM products WHERE LOWER(name) = LOWER(:name) LIMIT 1',
            { replacements: { name: PRODUCT_NAME }, type: QueryTypes.SELECT, transaction },
        )) as Array<{ id: number }>;
        const now = new Date();
        let productId: number;
        if (existingProductRows.length > 0) {
            productId = existingProductRows[0].id;
            await qi.sequelize.query(`UPDATE products
         SET status = true,
             price = 0,
             updatedAt = :updatedAt
         WHERE id = :id`, {
                replacements: {
                    id: productId,
                    updatedAt: now,
                },
                type: QueryTypes.UPDATE,
                transaction,
            });
        }
        else {
            await qi.bulkInsert('products', [
                {
                    name: PRODUCT_NAME,
                    productTypeId: defaultProductTypeId,
                    price: 0,
                    createdAt: now,
                    updatedAt: now,
                    createdBy: defaultCreatedBy,
                    updatedBy: defaultCreatedBy,
                    status: true,
                },
            ], { transaction });
            const insertedProductRows = (await qi.sequelize.query(
                'SELECT id FROM products WHERE LOWER(name) = LOWER(:name) ORDER BY id DESC LIMIT 1',
                { replacements: { name: PRODUCT_NAME }, type: QueryTypes.SELECT, transaction },
            )) as Array<{ id: number }>;
            productId = insertedProductRows[0]?.id ?? 0;
        }
        if (!productId) {
            throw new Error('Failed to resolve Pub Crawl product id');
        }
        await qi.bulkDelete('product_addons', { product_id: productId }, { transaction });
        const productAddonRows = PRODUCT_ADDONS.map((entry) => {
            const addonId = addonIds.get(entry.addonName);
            if (!addonId) {
                throw new Error(`Missing addon id for ${entry.addonName}`);
            }
            return {
                product_id: productId,
                addon_id: addonId,
                max_per_attendee: entry.maxPerAttendee,
                price_override: null,
                sort_order: entry.sortOrder,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        });
        await qi.bulkInsert('product_addons', productAddonRows, { transaction });
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}
export async function down({ context }: MigrationParams): Promise<void> {
    const qi = context;
    const transaction = await qi.sequelize.transaction();
    try {
        const productRows = (await qi.sequelize.query(
            'SELECT id FROM products WHERE LOWER(name) = LOWER(:name) LIMIT 1',
            { replacements: { name: PRODUCT_NAME }, type: QueryTypes.SELECT, transaction },
        )) as Array<{ id: number }>;
        if (productRows.length > 0) {
            const productId = productRows[0].id;
            await qi.bulkDelete('product_addons', { product_id: productId }, { transaction });
            await qi.bulkDelete('products', { id: productId }, { transaction });
        }
        await qi.sequelize.query('UPDATE products SET status = true', { type: QueryTypes.UPDATE, transaction });
        const addonNames = ADDONS.map((addon) => addon.name);
        await qi.bulkDelete('addons', { name: addonNames }, { transaction });
        const channelNames = CHANNELS.map((channel) => channel.name);
        await qi.bulkDelete('channels', { name: channelNames }, { transaction });
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}
