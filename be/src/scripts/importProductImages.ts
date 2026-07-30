import { readFile } from 'fs/promises';
import path from 'path';
import sequelize from '../config/database.js';
import Product from '../models/Product.js';
import type { ProductImage } from '../types/productMedia.js';

type MappingImage = ProductImage & Record<string, unknown>;
type MappingProduct = {
  productId: number;
  imageUrl: string | null;
  images: MappingImage[];
};
type ImageMapping = {
  products: MappingProduct[];
};

const mappingPath = process.argv[2];

if (!mappingPath) {
  throw new Error('Usage: importProductImages <path-to-image-mapping.json>');
}

const normalizeImages = (images: unknown, productId: number): ProductImage[] => {
  if (!Array.isArray(images)) {
    throw new Error(`Product ${productId}: images must be an array`);
  }
  return images
    .map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Product ${productId}: images[${index}] must be an object`);
      }
      const image = value as Record<string, unknown>;
      const url = typeof image.url === 'string' ? image.url.trim() : '';
      const alt = typeof image.alt === 'string' ? image.alt.trim() : '';
      const order = Number(image.order);
      if (!url || !Number.isInteger(order) || order < 1) {
        throw new Error(`Product ${productId}: images[${index}] has an invalid url or order`);
      }
      return { url, alt, order };
    })
    .sort((left, right) => left.order - right.order);
};

const run = async (): Promise<void> => {
  const absolutePath = path.resolve(mappingPath);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8')) as ImageMapping;
  if (!parsed || !Array.isArray(parsed.products)) {
    throw new Error('Mapping file must contain a products array');
  }

  const seen = new Set<number>();
  const missingProductIds: number[] = [];
  let imported = 0;

  await sequelize.transaction(async (transaction) => {
    for (const entry of parsed.products) {
      const productId = Number(entry?.productId);
      if (!Number.isInteger(productId) || productId <= 0 || seen.has(productId)) {
        throw new Error(`Invalid or duplicate productId: ${String(entry?.productId)}`);
      }
      seen.add(productId);

      const product = await Product.findByPk(productId, { transaction });
      if (!product) {
        missingProductIds.push(productId);
        continue;
      }

      const imageUrl =
        entry.imageUrl === null
          ? null
          : typeof entry.imageUrl === 'string'
            ? entry.imageUrl.trim() || null
            : (() => {
                throw new Error(`Product ${productId}: imageUrl must be a string or null`);
              })();
      const images = normalizeImages(entry.images, productId);
      await product.update({ imageUrl, images }, { transaction });
      imported += 1;
    }
  });

  console.log(JSON.stringify({
    source: absolutePath,
    records: parsed.products.length,
    imported,
    missingProductIds,
  }, null, 2));
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
