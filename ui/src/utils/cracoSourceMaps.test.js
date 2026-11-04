const { webpack } = require('../../craco.config.cjs');

test('retains application maps while generating dependency maps from shipped JavaScript', () => {
  const application = { loader: '/loaders/babel-loader/index.js', include: '/app/src', options: { sourceMaps: true, inputSourceMap: true } };
  const dependencies = { loader: '/loaders/babel-loader/index.js', exclude: /babel-runtime/, options: { sourceMaps: true, inputSourceMap: true } };
  const upstream = { loader: '/loaders/source-map-loader/index.js' };
  const config = webpack.configure({ module: { rules: [upstream, { oneOf: [application, dependencies] }] } });
  const [app, fallback, normal] = config.module.rules[1].oneOf;
  expect(app).toBe(application);
  expect(app.options.inputSourceMap).toBe(true);
  expect(normal).toBe(dependencies);
  expect(fallback.options).toEqual({ sourceMaps: true, inputSourceMap: false });
  expect(fallback.include.test('/app/node_modules/sql-formatter/dist/esm/index.js')).toBe(true);
  expect(fallback.include.test('C:\\app\\node_modules\\fast-equals\\index.js')).toBe(true);
  expect(fallback.include.test('/app/node_modules/@codemirror/view/dist/index.js')).toBe(false);
  expect(Array.isArray(upstream.exclude)).toBe(false);
  expect(upstream.exclude.test('/app/node_modules/sql-formatter/dist/esm/index.js')).toBe(true);
});
