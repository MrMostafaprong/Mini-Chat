import http from "http";
import dotenv from "dotenv";
import app from "./app.js";
import pool, { testConnection } from "./database.js";
import { initializeSocket } from "./socket.js";
import logger from "./utils/logger.js";

dotenv.config();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer(app);

const io = initializeSocket(server);
app.set("io", io);

const startServer = async () => {
  try {
    await testConnection();

    server.listen(PORT, HOST, () => {
      logger.info({ port: PORT, host: HOST }, "🚀 Server started successfully");
      logger.info("🔒 Security: Helmet, CORS, Rate Limiting enabled");
    });

    // 🧹 تنظيف سجلات محاولات الدخول القديمة كل ساعة
    setInterval(
      async () => {
        try {
          const result = await pool.query(
            `DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours'`,
          );
          if (result.rowCount > 0) {
            logger.info(
              { cleaned: result.rowCount },
              "🧹 Cleaned old login attempts",
            );
          }
        } catch (err) {
          logger.error({ err: err.message }, "Error cleaning login_attempts");
        }
      },
      60 * 60 * 1000,
    );
  } catch (error) {
    logger.fatal({ err: error.message }, "❌ Failed to start server");
    process.exit(1);
  }
};

process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});

startServer();
