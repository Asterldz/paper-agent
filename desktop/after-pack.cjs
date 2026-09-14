'use strict';
const { cp, access } = require('node:fs/promises');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const source = path.join(context.packager.projectDir, 'dist/standalone/node_modules');
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
    : path.join(context.appOutDir, 'resources');
  const destination = path.join(resources, 'app-server/node_modules');
  // extraResources filters exclude node_modules; explicitly copy the traced
  // standalone runtime, not the project's complete development dependencies.
  await cp(source, destination, { recursive: true, dereference: true });
  // Vinext's standalone trace omits React peer runtimes that its server imports.
  for (const name of ['react', 'react-dom', 'scheduler', 'react-server-dom-webpack']) {
    await cp(path.join(context.packager.projectDir, 'node_modules', name), path.join(destination, name), { recursive: true, dereference: true });
  }
  await access(path.join(destination, 'vinext/package.json'));
};
