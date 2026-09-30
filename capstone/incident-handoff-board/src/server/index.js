import { createApp } from './app.js';
import { createStoreFromEnv } from './config.js';

const port = Number(process.env.PORT ?? 3000);
const store = await createStoreFromEnv();
createApp({ store }).listen(port, () => {
  console.log(`Incident handoff board listening on ${port} (storage: ${process.env.STORAGE_BACKEND ?? 'memory'})`);
});
