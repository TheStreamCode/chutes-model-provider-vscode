const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['test/unit.test.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'test/unit.test.cjs',
    alias: { vscode: './test/vscode-stub.cjs' }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
