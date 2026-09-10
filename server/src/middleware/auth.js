import jwt from "jsonwebtoken";
import pool from "../database.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("auth-middleware");

/**
 * Middleware للمصادقة عبر الكوكي (أو Authorization header كاحتياطي)
 * ⚠️ يتحقق من:
 *   - وجود التوكن
 *   - صلاحية التوكن (توقيع + تاريخ الانتهاء)
 *   - وجود المستخدم في قاعدة البيانات
 *   - تطابق token_version (يمنع استخدام توكنات قديمة بعد تغيير كلمة المرور)
 */
export const authenticate = async (req, res, next) => {
  try {
    // 1. قراءة التوكن من الكوكي أولاً
    let token = req.cookies?.token;

    // 2. احتياطي: من Authorization header
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }

    if (!token) {
      return res.status(401).json({
        error: "Authentication required",
        message: "No token provided",
      });
    }

    // 3. التحقق من صحة التوكن
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        log.debug(
          { path: req.originalUrl, ip: req.ip },
          "Request with expired token",
        );
        return res.status(401).json({
          error: "Token expired",
          message: "Please login again",
        });
      }

      log.warn(
        { path: req.originalUrl, ip: req.ip, reason: err.name },
        "Request with invalid token",
      );
      return res.status(401).json({
        error: "Invalid token",
        message: "Token is malformed",
      });
    }

    const userId = decoded.userId || decoded.id;
    const tokenVersion = decoded.tokenVersion;

    if (!userId) {
      log.warn(
        { path: req.originalUrl },
        "Token does not contain user ID",
      );
      return res.status(401).json({
        error: "Invalid token payload",
        message: "Token does not contain valid user ID",
      });
    }

    // 4. التحقق من وجود المستخدم
    const userResult = await pool.query(
      "SELECT id, username, email, avatar, token_version FROM users WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      log.warn(
        { userId, path: req.originalUrl },
        "Token belongs to deleted user",
      );
      return res.status(401).json({
        error: "User not found",
        message: "Account may have been deleted",
      });
    }

    const user = userResult.rows[0];

    // 5. 🔒 التحقق من إصدار التوكن
    if (tokenVersion !== user.token_version) {
      log.warn(
        { userId, path: req.originalUrl },
        "Token revoked - version mismatch",
      );
      return res.status(401).json({
        error: "Token revoked",
        message: "Your session has expired. Please login again.",
      });
    }

    // 6. إرفاق بيانات المستخدم بالطلب
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
    };

    next();
  } catch (error) {
    log.error(
      { err: error.message, path: req.originalUrl },
      "Unexpected error in auth middleware",
    );
    return res.status(500).json({
      error: "Internal server error",
      message: "Authentication process failed",
    });
  }
};

/**
 * Middleware اختياري — يسمح بالمرور حتى لو لم يكن هناك توكن
 * يُستخدم للمسارات العامة التي قد تحتاج بيانات المستخدم إن وُجد
 */
export const optionalAuthenticate = async (req, res, next) => {
  try {
    let token = req.cookies?.token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }

    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId || decoded.id;

      if (userId) {
        const userResult = await pool.query(
          "SELECT id, username, email, avatar, token_version FROM users WHERE id = $1",
          [userId],
        );

        if (
          userResult.rows.length > 0 &&
          userResult.rows[0].token_version === decoded.tokenVersion
        ) {
          req.user = {
            id: userResult.rows[0].id,
            username: userResult.rows[0].username,
            email: userResult.rows[0].email,
            avatar: userResult.rows[0].avatar,
          };
        }
      }
    } catch (err) {
      // نتجاهل أخطاء التوكن — هذا middleware اختياري
      log.debug(
        { path: req.originalUrl, reason: err.name },
        "Optional auth: invalid token ignored",
      );
    }

    next();
  } catch (error) {
    log.error(
      { err: error.message, path: req.originalUrl },
      "Unexpected error in optionalAuthenticate",
    );
    next();
  }
};