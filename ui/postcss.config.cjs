module.exports = {
    plugins: {
      'postcss-preset-mantine': {},
      'postcss-simple-vars': {
        variables: {
          'mantine-breakpoint-xs': '36em',
          'mantine-breakpoint-sm': '48em',
          'mantine-breakpoint-md': '62em',
          'mantine-breakpoint-lg': '75em',
          'mantine-breakpoint-xl': '88em',
        },
      },
      'postcss-exclude-files': {
        files: ['./mantine-react-table/styles.css'],
      },
      cssnano: {
        preset: [
          'default',
          {
            calc: {
              precision: 2,
              ignoreCalc: true, // Ignore errors in calc functions
            },
          },
        ],
      },
    },
  };