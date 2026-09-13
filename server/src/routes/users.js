import express from "express";
import rateLimit from "express-rate-limit";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../database.js";
import { authenticate } from "../middleware/auth.js";
import { emitToUser } from "../socket.js";
import { createModuleLogger } from "../utils/logger.js";

const router = express.Router();
const log = createModuleLogger("users");

router.use(authenticate);

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

// 🔒 Rate limiter مخصوص للبحث — مفتاحه معرف المستخدم (ليس IP)
// يمنع استخدام endpoint البحث لتعداد (enumerate) أسماء المستخدمين بسرعة كبيرة
// عبر الحد العام المشترك مع كل طلبات /api/ الأخرى
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 عملية بحث في الدقيقة
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
  message: {
    error: "Rate limit exceeded",
    message: "You are searching too quickly. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

/**
 * إخطار كل من يشارك المستخدم في محادثة بأن بياناته تغيّرت
 * 🔒 حد 200 مستخدم + كسر مبكر لتفادي إرهاق الذاكرة
 */
const notifySharedUsers = async (userId) => {
  try {
    const shared = await pool.query(
      `SELECT DISTINCT cm2.user_id 
       FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
       WHERE cm1.user_id = $1 AND cm2.user_id != $1
       LIMIT 200`,
      [userId],
    );

    if (shared.rows.length === 0) return;

    // استخدام Promise.all لإرسال الإخطارات بالتوازي
    await Promise.all(
      shared.rows.map(({ user_id }) =>
        Promise.resolve(emitToUser(user_id, "user-updated", { id: userId })),
      ),
    );
  } catch (err) {
    log.error({ err: err.message, userId }, "Error notifying shared users");
  }
};

/**
 * GET /api/users/profile
 */
router.get("/profile", async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      "SELECT id, username, email, avatar, created_at FROM users WHERE id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
        message: "Profile not found",
      });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    log.error(
      { err: error.message, userId: req.user?.id },
      "Error fetching profile",
    );
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to fetch profile",
    });
  }
});

/**
 * PUT /api/users/profile
 * ⚠️ يتطلب كلمة المرور الحالية لأي تغيير حساس
 * ⚠️ تغيير كلمة المرور يُبطل كل الجلسات الأخرى (token_version++)
 */
router.put("/profile", async (req, res) => {
  try {
    const userId = req.user.id;
    const { email, currentPassword, newPassword } = req.body;

    const userResult = await pool.query(
      "SELECT id, username, email, password, token_version FROM users WHERE id = $1",
      [userId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
        message: "Profile not found",
      });
    }

    const user = userResult.rows[0];
    const updates = [];
    const values = [];
    let paramIndex = 1;

    const isEmailChange =
      email && email.trim().toLowerCase() !== user.email.toLowerCase();
    const isPasswordChange = !!newPassword;

    // 🔒 أي عملية حساسة تتطلب كلمة المرور الحالية
    if (isEmailChange || isPasswordChange) {
      if (!currentPassword) {
        return res.status(400).json({
          error: "Current password required",
          message:
            "Please provide your current password to change email or password",
        });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({
          error: "Invalid current password",
          message: "The current password is incorrect",
        });
      }
    }

    // تغيير البريد الإلكتروني
    if (isEmailChange) {
      const cleanEmail = email.trim().toLowerCase();
      if (!validator.isEmail(cleanEmail) || cleanEmail.length > 100) {
        return res.status(400).json({
          error: "Invalid email",
          message: "Please provide a valid email address",
        });
      }

      const existing = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [cleanEmail, userId],
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: "Update failed",
          message: "Unable to update with the provided data",
        });
      }

      updates.push(`email = $${paramIndex++}`);
      values.push(cleanEmail);
    }

    // تغيير كلمة المرور + زيادة token_version
    let newTokenVersion = user.token_version;
    if (isPasswordChange) {
      if (
        typeof newPassword !== "string" ||
        newPassword.length < 8 ||
        newPassword.length > 128
      ) {
        return res.status(400).json({
          error: "Weak password",
          message: "Password must be between 8 and 128 characters",
        });
      }
      if (
        !/[A-Z]/.test(newPassword) ||
        !/[a-z]/.test(newPassword) ||
        !/\d/.test(newPassword)
      ) {
        return res.status(400).json({
          error: "Weak password",
          message: "Password must include uppercase, lowercase and numbers",
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      updates.push(`password = $${paramIndex++}`);
      values.push(hashedPassword);

      // 🔒 زيادة token_version لإبطال كل الجلسات الأخرى
      newTokenVersion = user.token_version + 1;
      updates.push(`token_version = $${paramIndex++}`);
      values.push(newTokenVersion);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: "No changes",
        message: "No changes to update",
      });
    }

    values.push(userId);
    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING id, username, email, avatar`;

    const updated = await pool.query(query, values);

    // 🔒 إعادة توقيع كوكي جديد للجلسة الحالية
    if (isPasswordChange) {
      const newToken = jwt.sign(
        { userId, tokenVersion: newTokenVersion },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
      );
      res.cookie("token", newToken, cookieOptions);

      log.info(
        { userId, emailChanged: isEmailChange, passwordChanged: true },
        "User updated credentials, all sessions revoked",
      );
    } else if (isEmailChange) {
      log.info({ userId, emailChanged: true }, "User updated email");
    }

    await notifySharedUsers(userId);

    res.json({
      message: "Profile updated successfully",
      user: updated.rows[0],
      sessionsRevoked: isPasswordChange,
    });
  } catch (error) {
    log.error(
      { err: error.message, userId: req.user?.id },
      "Error updating profile",
    );
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to update profile",
    });
  }
});

/**
 * PUT /api/users/avatar
 * ⚠️ يقبل PNG/JPEG/WEBP/GIF فقط — يرفض SVG
 */
router.put("/avatar", async (req, res) => {
  try {
    const userId = req.user.id;
    const { avatar } = req.body;

    if (avatar === null) {
      await pool.query("UPDATE users SET avatar = NULL WHERE id = $1", [
        userId,
      ]);
      log.info({ userId }, "User removed avatar");
      await notifySharedUsers(userId);
      return res.json({ message: "Avatar removed", avatar: null });
    }

    if (typeof avatar !== "string" || avatar.length === 0) {
      return res.status(400).json({
        error: "Invalid avatar",
        message: "Avatar data is required",
      });
    }

    // 🔒 رفض SVG (يمكن أن يحتوي JavaScript)
    const allowedPrefixes = [
      "data:image/png;",
      "data:image/jpeg;",
      "data:image/jpg;",
      "data:image/webp;",
      "data:image/gif;",
    ];
    if (!allowedPrefixes.some((prefix) => avatar.startsWith(prefix))) {
      log.warn(
        { userId, prefix: avatar.substring(0, 30) },
        "Rejected avatar with invalid format",
      );
      return res.status(400).json({
        error: "Invalid avatar format",
        message: "Only PNG, JPEG, WEBP, and GIF images are allowed",
      });
    }

    if (avatar.length > 7000000) {
      return res.status(400).json({
        error: "Image too large",
        message: "Image must be smaller than 5MB",
      });
    }

    const result = await pool.query(
      "UPDATE users SET avatar = $1 WHERE id = $2 RETURNING id, username, email, avatar",
      [avatar, userId],
    );

    log.info({ userId, avatarSize: avatar.length }, "User updated avatar");

    await notifySharedUsers(userId);

    res.json({
      message: "Avatar updated",
      user: result.rows[0],
    });
  } catch (error) {
    log.error(
      { err: error.message, userId: req.user?.id },
      "Error updating avatar",
    );
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to update avatar",
    });
  }
});

/**
 * GET /api/users/search?query=...
 * ⚠️ لا يُرجع البُرد الإلكترونية نهائياً
 * ⚠️ يهرب أحرف LIKE (% و _)
 */
router.get("/search", searchLimiter, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Missing query",
        message: "Search query is required",
      });
    }
    const cleanQuery = query.trim();
    if (cleanQuery.length === 0) {
      return res.status(400).json({
        error: "Empty query",
        message: "Search query cannot be empty",
      });
    }
    if (cleanQuery.length > 50) {
      return res.status(400).json({
        error: "Query too long",
        message: "Search query must be 50 characters or less",
      });
    }

    // 🔒 Escape LIKE wildcards
    const escaped = cleanQuery.replace(/[%_\\]/g, "\\$&");
    const searchPattern = `%${escaped}%`;

    const result = await pool.query(
      `SELECT id, username, avatar 
       FROM users 
       WHERE id != $1 
         AND username ILIKE $2 ESCAPE '\\'
       ORDER BY username
       LIMIT 20`,
      [req.user.id, searchPattern],
    );

    res.json(result.rows);
  } catch (error) {
    log.error(
      { err: error.message, userId: req.user?.id },
      "Error searching users",
    );
    res.status(500).json({
      error: "Internal server error",
      message: "Search failed",
    });
  }
});

export default router;
