const cracoConfig = {
  webpack: {
    configure: (webpackConfig) => {
      const sourceMapLoaderExclude = /node_modules[\\/](?:fast-equals|sql-formatter)[\\/]/;

      // Some dependencies publish maps referencing source files absent from
      // their npm package. Keep application maps, but skip only those packages.
      const patchSourceMapRule = (rule) => {
        if (Array.isArray(rule?.oneOf)) {
          rule.oneOf = rule.oneOf.flatMap((entry) => {
            // CRA also consumes upstream maps through babel-loader. Excluding
            // source-map-loader alone does not stop Babel importing incomplete
            // maps from these packages. Generate maps from their shipped JS.
            const isDependencyBabel = typeof entry?.loader === 'string'
              && entry.loader.includes('babel-loader')
              && !entry.include
              && entry.options?.sourceMaps === true;
            return isDependencyBabel ? [{
              ...entry,
              include: sourceMapLoaderExclude,
              options: { ...entry.options, inputSourceMap: false },
            }, entry] : [entry];
          });
        }
        const entries = [rule?.loader, ...(Array.isArray(rule?.use) ? rule.use : rule?.use ? [rule.use] : [])];
        if (entries.some(entry => (typeof entry === 'string' ? entry : entry?.loader || '').includes('source-map-loader'))) {
          rule.exclude = rule.exclude ? [rule.exclude, sourceMapLoaderExclude] : sourceMapLoaderExclude;
        }
        (rule?.oneOf || []).forEach(patchSourceMapRule);
        (rule?.rules || []).forEach(patchSourceMapRule);
      };
      webpackConfig.module?.rules?.forEach(patchSourceMapRule);

      webpackConfig.module?.rules?.forEach((rule) => {
        if (!Array.isArray(rule?.oneOf)) {
          return;
        }

        rule.oneOf.forEach((oneOfRule) => {
          const uses = Array.isArray(oneOfRule?.use) ? oneOfRule.use : oneOfRule?.use ? [oneOfRule.use] : [];
          const usesSourceMapLoader = uses.some((loaderEntry) => {
            if (typeof loaderEntry === 'string') {
              return loaderEntry.includes('source-map-loader');
            }
            return typeof loaderEntry?.loader === 'string' && loaderEntry.loader.includes('source-map-loader');
          });

          if (!usesSourceMapLoader) {
            return;
          }

          if (!oneOfRule.exclude) {
            oneOfRule.exclude = sourceMapLoaderExclude;
            return;
          }

          if (Array.isArray(oneOfRule.exclude)) {
            oneOfRule.exclude = [...oneOfRule.exclude, sourceMapLoaderExclude];
            return;
          }

          oneOfRule.exclude = [oneOfRule.exclude, sourceMapLoaderExclude];
        });
      });

      const existingIgnoreWarnings = webpackConfig.ignoreWarnings ?? [];
      webpackConfig.ignoreWarnings = [
        ...existingIgnoreWarnings,
        (warning) => {
          const text = [
            typeof warning === 'string' ? warning : '',
            warning?.message ?? '',
            warning?.details ?? '',
          ]
            .join('\n')
            .toLowerCase();
          return (
            text.includes('defineplugin') &&
            text.includes("conflicting values for 'process.env.node_env'")
          );
        },
      ];

      return webpackConfig;
    },
  },
  devServer: (devServerConfig) => {
    const beforeSetup = devServerConfig.onBeforeSetupMiddleware;
    const afterSetup = devServerConfig.onAfterSetupMiddleware;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      if (typeof beforeSetup === 'function') {
        beforeSetup(devServer);
      }

      if (typeof afterSetup === 'function') {
        afterSetup(devServer);
      }

      return middlewares;
    };

    delete devServerConfig.onBeforeSetupMiddleware;
    delete devServerConfig.onAfterSetupMiddleware;

    return devServerConfig;
  },
};

module.exports = cracoConfig;
