import { loadWebEnv } from "./config/env";

async function bootstrap() {
  const env = loadWebEnv();
  type AppFactory = (typeof import("./app"))["createApp"];
  let createApp: AppFactory;

  try {
    ({ createApp } = await import("./app"));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    if (err.code === "MODULE_NOT_FOUND" && err.message?.includes("'express'")) {
      console.error(
        "Missing required runtime dependency 'express'. Run `npm ci` on the server before starting the service."
      );
      process.exit(1);
    }

    throw error;
  }

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
