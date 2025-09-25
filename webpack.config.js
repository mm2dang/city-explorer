const path = require('path');

module.exports = {
  // Existing configuration
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
    // Add this to support WASM files
    assetModuleFilename: 'assets/[hash][ext][query]'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
        },
      },
      // Add rule for WebAssembly files
      {
        test: /\.wasm$/,
        type: 'asset/resource',
        generator: {
          filename: 'wasm/[hash][ext][query]'
        }
      },
    ],
  },
  resolve: {
    fallback: {
      // Disable Node.js core modules not needed in browser
      fs: false,
      path: false,
      zlib: false,
      lzo: false,
      stream: false,
      constants: false,
      net: false,
      tls: false,
      child_process: false,
      http: false,
      https: false,
      crypto: false,
      // Add buffer polyfill which is often needed for WASM
      buffer: require.resolve('buffer'),
    },
  },
  experiments: {
    asyncWebAssembly: true, // Enable WebAssembly support
    syncWebAssembly: true,  // Also enable sync WASM
  },
  // Add this to help with WASM loading
  devServer: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  }
};