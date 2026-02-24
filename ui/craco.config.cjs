const cracoConfig = {
  webpack: {
    configure: (webpackConfig) => {
      // Keep existing CSS minimizer workaround.
      webpackConfig.optimization?.minimizer?.forEach((minimizer) => {
        if (minimizer?.constructor?.name === 'CssMinimizerPlugin') {
          minimizer.options.exclude = /mantine-react-table\/styles\.css/;
        }
      });

      // @zxing/browser points to TS sourcemaps that are not published.
      // Ignore only those source-map-loader warnings.
      const existingIgnoreWarnings = webpackConfig.ignoreWarnings ?? [];
      webpackConfig.ignoreWarnings = [
        ...existingIgnoreWarnings,
        (warning) => {
          const text = [
            typeof warning === 'string' ? warning : '',
            warning?.message ?? '',
            warning?.details ?? '',
            warning?.module?.resource ?? '',
          ]
            .join('\n')
            .toLowerCase();
          return (
            text.includes('failed to parse source map') &&
            text.includes('node_modules') &&
            text.includes('@zxing')
          );
        },
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
};

module.exports = cracoConfig;
