const cracoConfig = {
    webpack: {
      configure: (webpackConfig, { env, paths }) => {
        // Exclude the problematic CSS file from minimization
        webpackConfig.optimization.minimizer.forEach((minimizer) => {
          if (minimizer.constructor.name === 'CssMinimizerPlugin') {
            minimizer.options.exclude = /mantine-react-table\/styles\.css/;
          }
        });
  
        return webpackConfig;
      },
    },
  };
  
  export default cracoConfig;