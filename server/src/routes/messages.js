import express from "express";
import rateLimit from "express-rate-limit";
import pool from "../database.js";
import { authenticate } from "../middleware/auth.js";
import { emitToUser } from "../socket.js";

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

    // 🔒 التحقق من نوع المحتوى الفعلي للصور (وليس الطول فقط) — يرفض SVG
    if (msgType === "image") {
      const allowedImagePrefixes = [
        "data:image/png;",
        "data:image/jpeg;",
        "data:image/jpg;",
        "data:image/webp;",
        "data:image/gif;",
      ];
      if (!allowedImagePrefixes.some((prefix) => cleanContent.startsWith(prefix))) {
        return res.status(400).json({
          error: "Invalid image format",
          message: "Only PNG, JPEG, WEBP, and GIF images are allowed",
        });
      }
    }

    // 🔒 التحقق من أن محتوى الملف بيانات base64 فعلية (data URI) بامتداد معروف
    // ⚠️ يطابق أنواع الملفات المسموح بها في MessageInput.jsx (accept="...pdf,.doc,.docx,.txt")
    if (msgType === "file") {
      const allowedFilePrefixes = [
        "data:application/pdf;",
        "data:application/msword;",
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;",
        "data:text/plain;",
      ];
      if (
        !allowedFilePrefixes.some((prefix) => cleanContent.startsWith(prefix)) ||
        !cleanContent.includes(";base64,")
      ) {
        return res.status(400).json({
          error: "Invalid file format",
          message: "Only PDF, DOC, DOCX, and TXT files are allowed",
        });
      }
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

    const responseMessage = {
      id: saved.id,
      conversationId: saved.conversation_id,
      senderId: saved.sender_id,
      senderName: userResult.rows[0]?.username || "Unknown",
      content: saved.content,
      type: saved.type,
      status: saved.status,
      createdAt: saved.created_at,
    };

    // 🔒 البث الفوري يتم من السيرفر مباشرة بعد نجاح الحفظ في قاعدة البيانات
    // (بدلاً من الاعتماد على نداء socket منفصل من الكلاينت، لضمان وصول كل
    // رسالة محفوظة فعلياً إلى بقية الأعضاء حتى لو انقطع اتصال المُرسل بعد الحفظ)
    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${convIdNum}`).emit("new-message", responseMessage);

      const otherMembers = await pool.query(
        `SELECT user_id FROM conversation_members 
         WHERE conversation_id = $1 AND user_id != $2`,
        [convIdNum, senderId],
      );
      otherMembers.rows.forEach(({ user_id }) => {
        emitToUser(user_id, "notification", {
          type: "message",
          conversationId: convIdNum,
          from: senderId,
        });
      });
    }

    res.status(201).json(responseMessage);
  } catch (error) {
    console.error("Error sending message:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to send message",
    });
  }
});

export default router;
