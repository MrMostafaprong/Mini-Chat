import { io } from "socket.io-client";

let socket = null;

export const initializeSocket = (userId) => {
  if (socket && socket.connected) {
    return socket;
  }

  socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5000", {
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    // ⚠️ Infinity: لا نوقف المحاولة أبداً — انقطاع الإنترنت قد يطول (تنقل، نفق، إلخ)
    // ونريد أن يعاود الاتصال تلقائياً مهما طالت المدة بدل إجبار المستخدم على تحديث الصفحة
    reconnectionAttempts: Infinity,
    timeout: 10000,
    autoConnect: true,
  });

  socket.on("connect_error", (err) => {
    console.error("Socket connection error:", err.message);
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
};

export default {
  initializeSocket,
  disconnectSocket,
};
