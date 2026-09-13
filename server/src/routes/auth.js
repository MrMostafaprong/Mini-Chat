import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import validator from "validator";
import pool from "../database.js";
import { authenticate, optionalAuthenticate } from "../middleware/auth.js";
import { createModuleLogger } from "../utils/logger.js";

const router = express.Router();
const log = createModuleLogger("auth");

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;

const generateToken = (userId, tokenVersion) => {
  return jwt.sign({ userId, tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

const isPasswordStrong = (password) => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  return (
    password.length >= minLength && hasUpperCase && hasLowerCase && hasNumber
  );
};

/**
 * POST /api/auth/register
 */
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Username, email and password are required",
      });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!validator.isLength(cleanUsername, { min: 3, max: 30 })) {
      return res.status(400).json({
        error: "Invalid username",
        message: "Username must be between 3 and 30 characters",
      });
    }
    if (!validator.matches(cleanUsername, /^[a-zA-Z0-9\u0600-\u06FF\s]+$/)) {
      return res.status(400).json({
        error: "Invalid username format",
        message: "Username can only contain letters, numbers and spaces",
      });
    }

    if (!validator.isEmail(cleanEmail) || cleanEmail.length > 100) {
      return res.status(400).json({
        error: "Invalid email",
        message: "Please provide a valid email address",
      });
    }

    if (!isPasswordStrong(password) || password.length > 128) {
      return res.status(400).json({
        error: "Weak password",
        message:
          "Password must be 8-128 characters with uppercase, lowercase and numbers",
      });
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1 OR username = $2",
      [cleanEmail, cleanUsername],
    );

    if (existingUser.rows.length > 0) {
      // 🔒 رسالة عامة لا تكشف ما إذا كان البريد/الاسم موجوداً
      log.warn(
        { email: cleanEmail, username: cleanUsername },
        "Registration attempt with existing credentials",
      );
      return res.status(409).json({
        error: "Registration failed",
        message: "Unable to create account with the provided data",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password) 
       VALUES ($1, $2, $3) 
       RETURNING id, username, email, avatar, token_version, created_at`,
      [cleanUsername, cleanEmail, hashedPassword],
    );

    const newUser = result.rows[0];
    const token = generateToken(newUser.id, newUser.token_version);

    res.cookie("token", token, cookieOptions);

    log.info(
      { userId: newUser.id, username: newUser.username },
      "New user registered",
    );

    res.status(201).json({
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        avatar: newUser.avatar,
      },
    });
  } catch (error) {
    log.error({ err: error.message }, "Registration error");
    res.status(500).json({
      error: "Internal server error",
      message: "Registration failed",
    });
  }
});

/**
 * POST /api/auth/login
 * ⚠️ مع قفل الحساب بعد 5 محاولات فاشلة
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Missing credentials",
        message: "Email and password are required",
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!validator.isEmail(cleanEmail)) {
      return res.status(400).json({
        error: "Invalid email",
        message: "Please provide a valid email address",
      });
    }

    // 🔒 التحقق من قفل الحساب
    const attemptsResult = await pool.query(
      `SELECT COUNT(*) as count FROM login_attempts 
       WHERE email = $1 
         AND attempted_at > NOW() - INTERVAL '${LOCK_WINDOW_MINUTES} minutes'`,
      [cleanEmail],
    );

    const failedAttempts = parseInt(attemptsResult.rows[0].count, 10);

    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      log.warn(
        { email: cleanEmail, failedAttempts },
        "Login blocked - account temporarily locked",
      );
      return res.status(429).json({
        error: "Account temporarily locked",
        message: `Too many failed attempts. Please try again in ${LOCK_WINDOW_MINUTES} minutes.`,
      });
    }

    const userResult = await pool.query(
      `SELECT id, username, email, password, avatar, token_version 
       FROM users WHERE email = $1`,
      [cleanEmail],
    );

    const dummyHash =
      "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5UzG4gGvGQqQqQqQqQqQqQqQqQqQqQq";
    const user = userResult.rows[0];
    const passwordHash = user ? user.password : dummyHash;

    const isMatch = await bcrypt.compare(password, passwordHash);

    if (!user || !isMatch) {
      // سجل المحاولة الفاشلة
      const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
      await pool.query(
        `INSERT INTO login_attempts (email, ip_address) VALUES ($1, $2)`,
        [cleanEmail, String(clientIp).substring(0, 45)],
      );

      log.warn(
        { email: cleanEmail, ip: clientIp, attempt: failedAttempts + 1 },
        "Failed login attempt",
      );

      return res.status(401).json({
        error: "Invalid credentials",
        message: "Email or password is incorrect",
      });
    }

    // ✅ نجح الدخول: امسح المحاولات الفاشلة
    await pool.query(`DELETE FROM login_attempts WHERE email = $1`, [
      cleanEmail,
    ]);

    const token = generateToken(user.id, user.token_version);

    res.cookie("token", token, cookieOptions);

    log.info(
      { userId: user.id, username: user.username },
      "User logged in successfully",
    );

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    log.error({ err: error.message }, "Login error");
    res.status(500).json({
      error: "Internal server error",
      message: "Login failed",
    });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      avatar: req.user.avatar,
    },
  });
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", optionalAuthenticate, (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  log.info({ userId: req.user?.id }, "User logged out");

  res.json({ message: "Logged out successfully" });
});

export default router;
