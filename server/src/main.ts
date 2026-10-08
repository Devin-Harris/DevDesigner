import { startServer } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await startServer();
  // eslint-disable-next-line no-console
  console.log(`DBDesigner API listening on ${await app.getUrl()}/api`);
}

void bootstrap();
