const path = require('path');
const webpack = require('webpack');
const glob = require('glob');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { SubresourceIntegrityPlugin } = require('webpack-subresource-integrity');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const PurgeCSSPlugin = require('purgecss-webpack-plugin')
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const gui = {
  entry: './src/gui/index.ts',
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: [/node_modules/, /tests/]
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader'
        ]
      }
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'Send files privately & securely',
      template: 'index.html',
      //template: '!!prerender-loader?string!index.html',
    }),
    new MiniCssExtractPlugin({filename: 'main.[contenthash].css'}),
    new PurgeCSSPlugin({
      // Give paths to parse for rules. These should be absolute!
      paths: glob.sync(path.join(__dirname, 'src/gui/*.ts')),
    }),
    new SubresourceIntegrityPlugin()
  ],
  output: {
    filename: 'main.[contenthash].js',
    path: path.resolve(__dirname, 'dist_web'),
    crossOriginLoading: "anonymous",
  },
  optimization: {
    realContentHash: true,
  },
};

const dl = {
  entry: './src/dl/index.ts',
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: [/node_modules/, /tests/]
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader'
        ]
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'Send files privately & securely',
      template: 'dl.html',
      filename: 'dl.html'
    }),
    new MiniCssExtractPlugin({filename: 'dl.[contenthash].css'}),
    new SubresourceIntegrityPlugin()
  ],
  output: {
    filename: 'dl.[contenthash].js',
    path: path.resolve(__dirname, 'dist_web'),
    crossOriginLoading: "anonymous",
  },
  optimization: {
    realContentHash: true,
  },
}

const sw = {
  target: 'webworker',
  entry: {
    serviceWorker: './src/sw/index.ts',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [{
          loader: 'ts-loader',
          options: {
            configFile: "src/sw/tsconfig.json"
          }
        }],
        exclude: [/node_modules/, /tests/]
      },
    ],
  },
  output: {
    filename: 'sw.js',
    path: path.resolve(__dirname, 'dist_web'),
  },
  //plugins: [new webpack.IgnorePlugin(/\.\.\/dist/)]
  plugins: []
};

module.exports = (env, argv) => {
  const ret = [gui, sw, dl];
  if (argv.mode === 'none') {
    for (const obj of ret) {
      obj.devtool = 'inline-source-map';
    }
    //gui.plugins.push(new BundleAnalyzerPlugin());
  }
  return ret;
}
