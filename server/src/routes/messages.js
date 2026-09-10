import express from "express";
import rateLimit from "express-rate-limit";
import pool from "../database.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticate);

// 🔒 Rate limiter للرسائل — مفتاحه معرف المستخدم (ليس IP)
const messageMinuteLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة
  max: 30, // 30 رسالة/دقيقة
  keyGenerator: (req) => {
    return req.user?.id?.toString() || req.ip;
  },
  message: {
    error: "Rate limit exceeded",
    message: "You are sending messages too quickly. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // في حالة التطوير نمنع التحذيرات الغريبة
  validate: { trustProxy: false },
});

const messageHourLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // ساعة
  max: 500, // 500 رسالة/ساعة
  keyGenerator: (req) => {
    return req.user?.id?.toString() || req.ip;
  },
  message: {
    error: "Rate limit exceeded",
    message: "You have reached the hourly message limit.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

router.post("/", messageMinuteLimiter, messageHourLimiter, async (req, res) => {
  try {
    const { conversationId, type, content } = req.body;
    const senderId = req.user.id;

    if (!conversationId) {
      return res.status(400).json({
        error: "Missing conversationId",
        message: "Conversation ID is required",
      });
    }

    const convIdNum = parseInt(conversationId, 10);
    if (isNaN(convIdNum) || convIdNum <= 0) {
      return res.status(400).json({
        error: "Invalid conversationId",
        message: "Conversation ID must be a positive number",
      });
    }

    const allowedTypes = ["text", "image", "file"];
    const msgType = type || "text";
    if (!allowedTypes.includes(msgType)) {
      return res.status(400).json({
        error: "Invalid message type",
        message: "Type must be one of: text, image, file",
      });
    }

    if (!content || typeof content !== "string") {
      return res.status(400).json({
        error: "Missing content",
        message: "Message content is required",
      });
    }

    const cleanContent = content.trim();
    if (cleanContent.length === 0) {
      return res.status(400).json({
        error: "Empty content",
        message: "Message content cannot be empty",
      });
    }

    const maxLengths = { text: 5000, image: 7000000, file: 7000000 };
    if (cleanContent.length > maxLengths[msgType]) {
      return res.status(400).json({
        error: "Content too long",
        message: `Content exceeds maximum length of ${maxLengths[msgType]} characters`,
      });
    }

    // 🔒 التحقق من العضوية
    const membershipCheck = await pool.query(
      `SELECT id FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [convIdNum, senderId],
    );
    if (membershipCheck.rows.length === 0) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You are not a member of this conversation",
      });
    }

    const insertResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content, type, status) 
       VALUES ($1, $2, $3, $4, 'sent') 
       RETURNING id, conversation_id, sender_id, content, type, status, created_at`,
      [convIdNum, senderId, cleanContent, msgType],
    );

    const saved = insertResult.rows[0];

    const userResult = await pool.query(
      "SELECT username FROM users WHERE id = $1",
      [senderId],
    );

    res.status(201).json({
      id: saved.id,
      conversationId: saved.conversation_id,
      senderId: saved.sender_id,
      senderName: userResult.rows[0]?.username || "Unknown",
      content: saved.content,
      type: saved.type,
      status: saved.status,
      createdAt: saved.created_at,
    });
  } catch (error) {
    console.error("Error sending message:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to send message",
    });
  }
});

export default router;
