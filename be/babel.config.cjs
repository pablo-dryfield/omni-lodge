module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
  ],
  plugins: [
    // Strip TypeScript declarations before the decorator transform runs.
    // Babel otherwise treats decorated `declare` model fields as initialized
    // fields and rejects valid sequelize-typescript models.
    ['@babel/plugin-transform-typescript', { allowDeclareFields: true }],
    ['@babel/plugin-proposal-decorators', { legacy: true }],
  ],
};
