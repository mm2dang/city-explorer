const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
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
      {
        test: /\.wasm$/,
        type: 'asset/resource',
        generator: {
          filename: 'wasm/[hash][ext][query]'
        }
      },
      // Optional: Add CSS loader if not already present
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    fallback: {
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
      buffer: require.resolve('buffer'),
    },
  },
  experiments: {
    asyncWebAssembly: true,
    syncWebAssembly: true,
  },
  devServer: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  }
};