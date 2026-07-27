import resolve from 'rollup-plugin-node-resolve';

// Bundles the prototype into a plain IIFE so prototype/index.html can be opened
// straight from disk, without a dev server.
export default {
  input: 'prototype/app.js',
  output: {
    file: 'prototype/bundle.js',
    format: 'iife',
    sourcemap: false,
  },
  plugins: [resolve()],
};
