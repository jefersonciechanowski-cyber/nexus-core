import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(projectRoot, 'dist');
const publicDirectories = [
  'apps/site-captacao',
  'apps/sst-controle',
  'apps/nexus-admin',
  'apps/portal-cliente',
];
const publicExtensions = new Set([
  '.avif', '.css', '.gif', '.html', '.ico', '.jpeg', '.jpg', '.js', '.map',
  '.png', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.otf',
]);
const excludedDirectoryNames = new Set(['.git', 'node_modules']);

function sourcePath(...segments) {
  return join(projectRoot, ...segments);
}

function isPublicFile(fileName) {
  return publicExtensions.has(extname(fileName).toLowerCase());
}

async function copyPublicDirectory(relativeDirectory) {
  const sourceDirectory = sourcePath(relativeDirectory);
  const destinationDirectory = join(distRoot, relativeDirectory);

  await cp(sourceDirectory, destinationDirectory, {
    recursive: true,
    filter: async (source) => {
      const entry = await lstat(source);

      if (entry.isSymbolicLink()) {
        return false;
      }

      if (entry.isDirectory()) {
        return !excludedDirectoryNames.has(source.split(/[\\/]/).at(-1));
      }

      return isPublicFile(source);
    },
  });
}

async function copyOptionalFile(fileName) {
  const source = sourcePath(fileName);

  try {
    const entry = await lstat(source);
    if (entry.isFile() && !entry.isSymbolicLink()) {
      await cp(source, join(distRoot, fileName));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function countDistFiles(directory) {
  let count = 0;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await countDistFiles(fullPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

await Promise.all([
  copyOptionalFile('index.html'),
  copyOptionalFile('404.html'),
  copyOptionalFile('.nojekyll'),
  ...publicDirectories.map(copyPublicDirectory),
]);

console.log(`Cloudflare assets prepared: ${await countDistFiles(distRoot)} files in ${relative(projectRoot, distRoot)}`);
