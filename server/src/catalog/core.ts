// The one place the server loads the shared TypeScript core: the prebuilt ESM bundle
// (npm run build:core:node in the repo root → server/vendor/prisma-core.mjs). Nothing in the
// server imports ../src at runtime.
export * from '../../vendor/prisma-core.mjs';
