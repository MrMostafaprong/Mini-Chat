import express from "express";
import pool from "../database.js";
import { authenticate } from "../middleware/auth.js";
import { addUserToRoom } from "../socket.js";

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/conversations
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
         c.id,
         c.type,
         c.name AS group_name,
         c.avatar AS group_avatar,
         c.created_by,
         c.created_at,
         (SELECT u.id FROM users u 
          JOIN conversation_members cm ON cm.user_id = u.id
          WHERE cm.conversation_id = c.id AND u.id != $1
          LIMIT 1) AS participant_id,
         (SELECT u.username FROM users u 
          JOIN conversation_members cm ON cm.user_id = u.id
          WHERE cm.conversation_id = c.id AND u.id != $1
          LIMIT 1) AS participant_username,
         (SELECT u.email FROM users u 
          JOIN conversation_members cm ON cm.user_id = u.id
          WHERE cm.conversation_id = c.id AND u.id != $1
          LIMIT 1) AS participant_email,
         (SELECT u.avatar FROM users u 
          JOIN conversation_members cm ON cm.user_id = u.id
          WHERE cm.conversation_id = c.id AND u.id != $1
          LIMIT 1) AS participant_avatar,
         (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
         lm.content AS last_message_content,
         lm.created_at AS last_message_time,
         lm.sender_id AS last_message_sender_id,
         (SELECT username FROM users WHERE id = lm.sender_id) AS last_message_sender_name,
         (SELECT COUNT(*) FROM messages m 
          WHERE m.conversation_id = c.id 
            AND m.sender_id != $1 
            AND m.status != 'read') AS unread_count
       FROM conversations c
       JOIN conversation_members my_cm 
         ON my_cm.conversation_id = c.id AND my_cm.user_id = $1
       LEFT JOIN LATERAL (
         SELECT content, created_at, sender_id 
         FROM messages 
         WHERE conversation_id = c.id 
         ORDER BY created_at DESC 
         LIMIT 1
       ) lm ON true
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [userId],
    );

    const conversations = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.group_name,
      avatar: row.group_avatar,
      createdBy: row.created_by,
      memberCount: parseInt(row.member_count, 10),
      participant:
        row.type === "private"
          ? {
              id: row.participant_id,
              username: row.participant_username,
              email: row.participant_email,
              avatar: row.participant_avatar,
            }
          : null,
      lastMessage: row.last_message_content
        ? {
            content: row.last_message_content,
            createdAt: row.last_message_time,
            senderId: row.last_message_sender_id,
            senderName: row.last_message_sender_name,
          }
        : null,
      unreadCount: parseInt(row.unread_count, 10),
    }));

    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to fetch conversations",
    });
  }
});

/**
 * POST /api/conversations
 */
router.post("/", async (req, res) => {
  try {
    const { participantId } = req.body;
    const userId = req.user.id;

    if (!participantId) {
      return res.status(400).json({
        error: "Missing participantId",
        message: "Participant ID is required",
      });
    }

    const participantIdNum = parseInt(participantId, 10);
    if (isNaN(participantIdNum) || participantIdNum <= 0) {
      return res.status(400).json({
        error: "Invalid participantId",
        message: "Participant ID must be a positive number",
      });
    }

    if (participantIdNum === userId) {
      return res.status(400).json({
        error: "Invalid participant",
        message: "Cannot create conversation with yourself",
      });
    }

    const participantResult = await pool.query(
      "SELECT id, username, email, avatar FROM users WHERE id = $1",
      [participantIdNum],
    );
    if (participantResult.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
        message: "Participant does not exist",
      });
    }

    const smallerId = Math.min(userId, participantIdNum);
    const largerId = Math.max(userId, participantIdNum);

    const existingConv = await pool.query(
      `SELECT id FROM conversations 
       WHERE type = 'private' AND user1_id = $1 AND user2_id = $2`,
      [smallerId, largerId],
    );

    let convId;

    if (existingConv.rows.length > 0) {
      convId = existingConv.rows[0].id;
    } else {
      const insertResult = await pool.query(
        `INSERT INTO conversations (type, user1_id, user2_id) 
         VALUES ('private', $1, $2) 
         RETURNING id`,
        [smallerId, largerId],
      );
      convId = insertResult.rows[0].id;

      await pool.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
        [convId, smallerId, largerId],
      );
    }

    addUserToRoom(userId, `conversation:${convId}`);
    addUserToRoom(participantIdNum, `conversation:${convId}`);

    const participant = participantResult.rows[0];

    res.status(201).json({
      id: convId,
      type: "private",
      participant: {
        id: participant.id,
        username: participant.username,
        email: participant.email,
        avatar: participant.avatar,
      },
    });
  } catch (error) {
    console.error("Error creating conversation:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to create conversation",
    });
  }
});

/**
 * GET /api/conversations/:id/messages
 * ⚠️ Pagination إجباري لتفادي إرجاع آلاف الرسائل التاريخية في نداء واحد
 *   - افتراضياً: يرجع آخر 50 رسالة (الأحدث) — نفس سلوك تطبيقات الشات المعتادة
 *   - query params:
 *     - limit: عدد الرسائل (1-100، افتراضي 50)
 *     - before: معرف رسالة — يرجع الرسائل الأقدم من هذه الرسالة (لتحميل المزيد للأعلى)
 */
router.get("/:id/messages", async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    if (isNaN(conversationId) || conversationId <= 0) {
      return res.status(400).json({
        error: "Invalid conversation ID",
        message: "Conversation ID must be a positive number",
      });
    }

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 100);

    let beforeId = null;
    if (req.query.before !== undefined) {
      beforeId = parseInt(req.query.before, 10);
      if (isNaN(beforeId) || beforeId <= 0) {
        return res.status(400).json({
          error: "Invalid before",
          message: "before must be a positive message ID",
        });
      }
    }

    const membershipCheck = await pool.query(
      `SELECT id FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (membershipCheck.rows.length === 0) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You do not have access to this conversation",
      });
    }

    // نجلب أحدث `limit` رسالة (أو الأقدم من beforeId) مرتبة تنازلياً في
    // الاستعلام نفسه، ثم نعكس الترتيب في الذاكرة لإرجاعها تصاعدياً كالمعتاد
    const params = beforeId
      ? [conversationId, beforeId, limit]
      : [conversationId, limit];

    const messagesResult = await pool.query(
      `SELECT m.id, m.sender_id, m.content, m.type, m.status, m.created_at,
              u.username AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 
         ${beforeId ? "AND m.id < $2" : ""}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $${beforeId ? 3 : 2}`,
      params,
    );

    const messages = messagesResult.rows
      .map((msg) => ({
        id: msg.id,
        senderId: msg.sender_id,
        senderName: msg.sender_name,
        content: msg.content,
        type: msg.type,
        status: msg.status,
        createdAt: msg.created_at,
      }))
      .reverse();

    res.json({
      messages,
      hasMore: messagesResult.rows.length === limit,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to fetch messages",
    });
  }
});

export default router;
