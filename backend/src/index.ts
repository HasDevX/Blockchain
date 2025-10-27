import { createApp } from "./app";
import { loadEnv } from "./config/env";

async function bootstrap() {
  const env = loadEnv();
  const app = await createApp();

  app.listen(env.port, () => {
    console.log(`ExplorerToken backend listening on port ${env.port}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  bootstrap().catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
}

export { createApp };
