const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const nodeBinary = process.execPath;

  execFileSync(nodeBinary, ['seed_instagram_posts.js', '--schema-only'], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  execFileSync(nodeBinary, ['seed_instagram_posts.js', '--seed-only'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      SEED_WITH_INTERACTIONS: 'false',
    },
  });
};
