import { loadEnvFile } from '../env';
import { createApp } from './app';

loadEnvFile();

export function startServer(options: { port?: number; host?: string; workspaceRoot?: string } = {}): {
  app: ReturnType<typeof createApp>;
  server: ReturnType<ReturnType<typeof createApp>['listen']>;
} {
  const app = createApp(options);
  const port = Number(options.port || process.env.WEB_UI_PORT || 3000);
  const host = options.host || process.env.WEB_UI_HOST || '127.0.0.1';

  const server = app.listen(port, host, () => {
    console.log(`Web UI running at http://${host}:${port}`);
  });

  return { app, server };
}

if (require.main === module) {
  startServer();
}
