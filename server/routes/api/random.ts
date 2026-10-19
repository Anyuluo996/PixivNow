// Legacy alias: the site footer linked /api/random?format=image for months
// and external consumers may call that path directly. Serve the same handler
// as /api/illust/random instead of letting it 404.
export { default } from './illust/random'
