const { createApp } = require('./app');
const { loadEnvFile } = require('../env');

loadEnvFile();

function startServer(options = {}) {
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

module.exports = {
  startServer
};
