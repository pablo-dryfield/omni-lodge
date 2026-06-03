const cracoConfig = {
  webpack: {
    configure: (webpackConfig) => {
      const sourceMapLoaderExclude = /node_modules[\\/]fast-equals[\\/]/;

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
