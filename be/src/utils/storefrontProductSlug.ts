export const createProductSlug = (product: { id: number; name: string }): string => {
  const slug = product.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'experience'}-${product.id}`;
};
