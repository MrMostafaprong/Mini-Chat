import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import validator from "validator";
import pool from "../database.js";

const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

const isPasswordStrong = (password) => {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  ) {
    return false;
  }
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  return hasUpperCase && hasLowerCase && hasNumber;
};

const sanitizeUsername = (username) => {
  if (typeof username !== "string") return null;
  const clean = username.trim();
  if (clean.length < 3 || clean.length > 30) return null;
  if (!validator.matches(clean, /^[a-zA-Z0-9\u0600-\u06FF\s]+$/)) return null;
  return clean;
};

const sanitizeEmail = (email) => {
  if (typeof email !== "string") return null;
  const clean = email.trim().toLowerCase();
  if (clean.length > 100 || !validator.isEmail(clean)) return null;
  return clean;
};

export const registerUser = async (username, email, password) => {
  const cleanUsername = sanitizeUsername(username);
  const cleanEmail = sanitizeEmail(email);

  if (!cleanUsername) {
    const error = new Error("Invalid username");
    error.statusCode = 400;
    error.safeMessage =
      "Username must be 3-30 characters and contain only letters, numbers, or spaces";
    throw error;
  }

  if (!cleanEmail) {
    const error = new Error("Invalid email");
    error.statusCode = 400;
    error.safeMessage = "Please provide a valid email address";
    throw error;
  }

  if (!isPasswordStrong(password)) {
    const error = new Error("Weak password");
    error.statusCode = 400;
    error.safeMessage =
      "Password must be at least 8 characters and include uppercase, lowercase, and numbers";
    throw error;
  }

  const existing = await pool.query(
    "SELECT id FROM users WHERE email = $1 OR username = $2",
    [cleanEmail, cleanUsername],
  );

  if (existing.rows.length > 0) {
    const error = new Error("User already exists");
    error.statusCode = 409;
    error.safeMessage = "Email or username is already registered";
    throw error;
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await pool.query(
    `INSERT INTO users (username, email, password)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, created_at`,
    [cleanUsername, cleanEmail, hashedPassword],
  );

  const newUser = result.rows[0];
  const token = generateToken(newUser.id);

  return {
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
    },
  };
};

export const loginUser = async (email, password) => {
  const cleanEmail = sanitizeEmail(email);

  if (!cleanEmail) {
    const error = new Error("Invalid email");
    error.statusCode = 400;
    error.safeMessage = "Please provide a valid email address";
    throw error;
  }

  if (typeof password !== "string" || password.length === 0) {
    const error = new Error("Missing password");
    error.statusCode = 400;
    error.safeMessage = "Password is required";
    throw error;
  }

  const userResult = await pool.query(
    "SELECT id, username, email, password FROM users WHERE email = $1",
    [cleanEmail],
  );

  const dummyHash =
    "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5UzG4gGvGQqQqQqQqQqQqQqQqQqQqQq";
  const user = userResult.rows[0];
  const passwordHash = user ? user.password : dummyHash;

  const isMatch = await bcrypt.compare(password, passwordHash);

  if (!user || !isMatch) {
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    error.safeMessage = "Email or password is incorrect";
    throw error;
  }

  const token = generateToken(user.id);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  };
};
