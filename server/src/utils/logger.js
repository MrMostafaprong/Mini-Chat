import pino from "pino";
import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

// 🔒 قائمة الحقول الحساسة التي يجب حجبها من السجلات
const REDACTED_PATHS = [
  "password",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "token",
  "tokenVersion",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.confirmPassword",
  "req.body.avatar", // قد يحتوي base64 ضخم
  "res.headers['set-cookie']",
];

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),

  // 🔒 إخفاء الحقول الحساسة
  redact: {
    paths: REDACTED_PATHS,
    censor: "[REDACTED]",
  },

  // في الإنتاج: JSON مُنظّم (لسجلات السيرفر)
  // في التطوير: مقروء بألوان
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          singleLine: false,
        },
      },

  // 🕐 طابع زمني موحد
  timestamp: pino.stdTimeFunctions.isoTime,

  // إضافة اسم الخدمة
  base: {
    service: "minichat-server",
    env: process.env.NODE_ENV || "development",
  },
});

export default logger;

/**
 * helper لإنشاء logger فرعي لكل وحدة
 * يُستخدم مثل: const log = createModuleLogger('users')
 */
export const createModuleLogger = (moduleName) => {
  return logger.child({ module: moduleName });
};
