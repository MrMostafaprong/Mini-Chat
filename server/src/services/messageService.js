import pool from "../database.js";

const isParticipant = async (conversationId, userId) => {
  const result = await pool.query(
    `SELECT id FROM conversation_members 
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  return result.rows.length > 0;
};

const parsePositiveInt = (value) => {
  const num = Number(value);
  if (Number.isInteger(num) && num > 0) return num;
  return null;
};

const sanitizeMessageType = (type) => {
  const allowed = ["text", "image", "file"];
  return allowed.includes(type) ? type : "text";
};

export const sendMessage = async (
  conversationId,
  senderId,
  content,
  type = "text",
) => {
  const convId = parsePositiveInt(conversationId);
  const sender = parsePositiveInt(senderId);

  if (!convId) {
    const error = new Error("Invalid conversationId");
    error.statusCode = 400;
    error.safeMessage = "Conversation ID must be a positive number";
    throw error;
  }

  if (!sender) {
    const error = new Error("Invalid senderId");
    error.statusCode = 400;
    error.safeMessage = "Sender ID is invalid";
    throw error;
  }

  const msgType = sanitizeMessageType(type);
  const maxLengths = { text: 5000, image: 7000000, file: 7000000 };

  if (typeof content !== "string" || content.trim().length === 0) {
    const error = new Error("Empty content");
    error.statusCode = 400;
    error.safeMessage = "Message content cannot be empty";
    throw error;
  }

  const cleanContent = content.trim();

  if (cleanContent.length > maxLengths[msgType]) {
    const error = new Error("Content too long");
    error.statusCode = 400;
    error.safeMessage = `Content exceeds maximum length of ${maxLengths[msgType]} characters`;
    throw error;
  }

  const isMember = await isParticipant(convId, sender);
  if (!isMember) {
    const error = new Error("Not a participant");
    error.statusCode = 403;
    error.safeMessage = "You are not a participant in this conversation";
    throw error;
  }

  const result = await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, content, type, status)
     VALUES ($1, $2, $3, $4, 'sent')
     RETURNING id, conversation_id, sender_id, content, type, status, created_at`,
    [convId, sender, cleanContent, msgType],
  );

  const saved = result.rows[0];

  return {
    id: saved.id,
    conversationId: saved.conversation_id,
    senderId: saved.sender_id,
    content: saved.content,
    type: saved.type,
    status: saved.status,
    createdAt: saved.created_at,
  };
};

export const getMessages = async (conversationId, userId) => {
  const convId = parsePositiveInt(conversationId);
  const user = parsePositiveInt(userId);

  if (!convId || !user) {
    const error = new Error("Invalid IDs");
    error.statusCode = 400;
    error.safeMessage = "Invalid conversation or user ID";
    throw error;
  }

  const isMember = await isParticipant(convId, user);
  if (!isMember) {
    const error = new Error("Not a participant");
    error.statusCode = 403;
    error.safeMessage = "You do not have access to this conversation";
    throw error;
  }

  const result = await pool.query(
    `SELECT id, sender_id, content, type, status, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [convId],
  );

  return result.rows.map((msg) => ({
    id: msg.id,
    senderId: msg.sender_id,
    content: msg.content,
    type: msg.type,
    status: msg.status,
    createdAt: msg.created_at,
  }));
};

export const markConversationAsRead = async (conversationId, readerId) => {
  const convId = parsePositiveInt(conversationId);
  const reader = parsePositiveInt(readerId);

  if (!convId || !reader) {
    const error = new Error("Invalid IDs");
    error.statusCode = 400;
    error.safeMessage = "Invalid conversation or user ID";
    throw error;
  }

  const isMember = await isParticipant(convId, reader);
  if (!isMember) {
    const error = new Error("Not a participant");
    error.statusCode = 403;
    error.safeMessage = "You are not a participant in this conversation";
    throw error;
  }

  const result = await pool.query(
    `UPDATE messages
     SET status = 'read'
     WHERE conversation_id = $1 AND sender_id != $2 AND status != 'read'`,
    [convId, reader],
  );

  return result.rowCount;
};
