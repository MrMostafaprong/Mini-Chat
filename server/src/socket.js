import logger from "./utils/logger.js";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "./database.js";

dotenv.config();

const connectedUsers = new Map();
let ioInstance = null;

// قراءة كوكي معينة من هيدر Cookie
const parseCookie = (cookieHeader, name) => {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").reduce((acc, c) => {
    const [key, ...val] = c.trim().split("=");
    acc[key] = val.join("=");
    return acc;
  }, {});
  return cookies[name] || null;
};

const authenticateSocket = async (socket, next) => {
  try {
    // 1. قراءة التوكن من الكوكي أولاً
    let token = parseCookie(socket.handshake.headers?.cookie, "token");

    // 2. احتياطي: من auth.token
    if (!token) {
      token = socket.handshake.auth?.token;
    }

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const userResult = await pool.query(
      "SELECT id, username FROM users WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return next(new Error("User not found"));
    }

    socket.userId = userId;
    socket.username = userResult.rows[0].username;
    next();
  } catch (error) {
    logger.error({ err: error.message }, "Socket authentication error");
    next(new Error("Authentication failed"));
  }
};

export const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(",")
        : ["http://localhost:5173", "http://localhost:3000"],
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  });

  ioInstance = io;
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const userId = socket.userId;
    connectedUsers.set(userId, socket.id);

    // بث حالة الاتصال فقط للمستخدمين الذين يشاركونه محادثة
    const broadcastOnlineStatus = async () => {
      try {
        const shared = await pool.query(
          `SELECT DISTINCT cm2.user_id 
           FROM conversation_members cm1
           JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
           WHERE cm1.user_id = $1 AND cm2.user_id != $1`,
          [userId],
        );
        const onlineList = Array.from(connectedUsers.keys());
        shared.rows.forEach(({ user_id }) => {
          if (connectedUsers.has(user_id)) {
            io.to(connectedUsers.get(user_id)).emit(
              "online-users",
              onlineList.filter(
                (id) =>
                  shared.rows.some((r) => r.user_id === id) || id === user_id,
              ),
            );
          }
        });
        // أرسل لنفسه أيضاً
        socket.emit("online-users", onlineList);
      } catch (err) {
        logger.error({ err: err.message }, "Error broadcasting online status");
      }
    };

    logger.info(`✅ User connected: ${socket.username} (ID: ${userId})`);
    broadcastOnlineStatus();

    const joinUserRooms = async () => {
      try {
        const result = await pool.query(
          `SELECT conversation_id FROM conversation_members WHERE user_id = $1`,
          [userId],
        );
        result.rows.forEach((row) => {
          socket.join(`conversation:${row.conversation_id}`);
        });
      } catch (error) {
        console.error("Error joining conversations:", error);
      }
    };

    joinUserRooms();
    socket.on("join-conversations", joinUserRooms);

    socket.on("send-message", async (data) => {
      try {
        const { conversationId, message, recipientId } = data;

        const convCheck = await pool.query(
          `SELECT id FROM conversation_members 
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, userId],
        );
        if (convCheck.rows.length === 0) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        io.to(`conversation:${conversationId}`).emit("new-message", {
          ...message,
          senderId: userId,
        });

        if (recipientId && connectedUsers.has(recipientId)) {
          const recipientSocketId = connectedUsers.get(recipientId);
          io.to(recipientSocketId).emit("notification", {
            type: "message",
            conversationId,
            from: userId,
          });
        }
      } catch (error) {
        console.error("Error sending message:", error);
      }
    });

    socket.on("typing", (data) => {
      const { conversationId, recipientId, isTyping } = data;
      if (recipientId && connectedUsers.has(recipientId)) {
        const recipientSocketId = connectedUsers.get(recipientId);
        io.to(recipientSocketId).emit("typing", {
          conversationId,
          userId,
          isTyping,
        });
      }
    });

    socket.on("read-messages", async (data) => {
      try {
        const { conversationId } = data;

        await pool.query(
          `UPDATE messages SET status = 'read' 
           WHERE conversation_id = $1 AND sender_id != $2 AND status != 'read'`,
          [conversationId, userId],
        );

        const membersResult = await pool.query(
          `SELECT user_id FROM conversation_members 
           WHERE conversation_id = $1 AND user_id != $2`,
          [conversationId, userId],
        );

        membersResult.rows.forEach(({ user_id }) => {
          if (connectedUsers.has(user_id)) {
            const senderSocketId = connectedUsers.get(user_id);
            io.to(senderSocketId).emit("messages-read", {
              conversationId,
              readerId: userId,
            });
          }
        });
      } catch (error) {
        console.error("Error updating read status:", error);
      }
    });

    socket.on("disconnect", () => {
      connectedUsers.delete(userId);
      broadcastOnlineStatus();
      console.log(`❌ User disconnected: ${socket.username} (ID: ${userId})`);
    });
  });

  return io;
};

export const addUserToRoom = (userId, roomName) => {
  if (ioInstance && connectedUsers.has(userId)) {
    const socketId = connectedUsers.get(userId);
    const socket = ioInstance.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(roomName);
    }
  }
};

export const emitToUser = (userId, event, data) => {
  if (ioInstance && connectedUsers.has(userId)) {
    const socketId = connectedUsers.get(userId);
    ioInstance.to(socketId).emit(event, data);
  }
};
