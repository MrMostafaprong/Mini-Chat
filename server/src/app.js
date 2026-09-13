import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import conversationsRoutes from "./routes/conversations.js";
import messagesRoutes from "./routes/messages.js";
import groupsRoutes from "./routes/groups.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// 🔒 خلف reverse proxy (Nginx, Cloudflare, Heroku, ...) يجب تفعيل trust proxy
// حتى يقرأ Express عنوان IP الحقيقي للعميل من X-Forwarded-For بدلاً من IP
// الـ proxy نفسه — وإلا يصبح express-rate-limit غير فعّال (كل الطلبات
// ستظهر بنفس IP)، أو عرضة للخداع إذا لم يُضبط بعناية.
// TRUST_PROXY=1 (أو رقم عدد الـ proxies) في متغيرات البيئة عند النشر خلف proxy.
if (process.env.TRUST_PROXY) {
  const trustProxyValue = isNaN(Number(process.env.TRUST_PROXY))
    ? process.env.TRUST_PROXY
    : Number(process.env.TRUST_PROXY);
  app.set("trust proxy", trustProxyValue);
}

app.use(helmet());

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      // في الإنتاج: يجب وجود Origin مسموح
      if (IS_PRODUCTION) {
        if (origin && allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
      }

      // في التطوير: نسمح بطلبات بدون Origin (curl، Postman، etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.use(cookieParser());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: {
    error: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

app.use("/api/", generalLimiter);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/conversations", conversationsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/groups", groupsRoutes);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(notFound);
app.use(errorHandler);

export default app;
