import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { runFinanceNotificationCheck } from "./routes/finances";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed initial data if the database is empty
  await seedIfEmpty();

  // Run finance notification check immediately, then daily
  runFinanceNotificationCheck();
  setInterval(runFinanceNotificationCheck, 24 * 60 * 60 * 1000);
});
