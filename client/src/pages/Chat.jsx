import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar.jsx";
import ChatList from "../components/ChatList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import UserSearch from "../components/UserSearch.jsx";
import Modal from "../components/Modal.jsx";
import GroupCreateModal from "../components/GroupCreateModal.jsx";
import GroupInfoModal from "../components/GroupInfoModal.jsx";
import ProfileModal from "../components/ProfileModal.jsx";
import api from "../services/api.js";
import { initializeSocket, disconnectSocket } from "../services/socket.js";

function Chat({ user, setUser }) {
  const navigate = useNavigate();
  const socketRef = useRef(null);
  const activeConversationRef = useRef(null);

  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");

  const [showUserSearch, setShowUserSearch] = useState(false);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [groupInfoId, setGroupInfoId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // نحتفظ بآخر قيمة لمعرّف المحادثة النشطة في ref حتى لا يعتمد عليها
  // effect تهيئة الـ socket (انظر أدناه) فيعاد فتح الاتصال عند كل تبديل محادثة
  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  // التحقق من الجلسة
  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
    }
  }, [user, navigate]);

  // جلب المحادثات
  const fetchConversations = useCallback(async () => {
    try {
      const response = await api.get("/conversations");
      setConversations(response.data);
      setActiveConversation((prev) => {
        if (!prev) return prev;
        const updated = response.data.find((c) => c.id === prev.id);
        return updated || prev;
      });
    } catch (err) {
      console.error("Error fetching conversations:", err);
      if (err.response?.status === 401) {
        setUser(null);
        navigate("/login", { replace: true });
      } else {
        setError("فشل تحميل المحادثات");
      }
    } finally {
      setLoading(false);
    }
  }, [navigate, setUser]);

  // تهيئة Socket.IO
  // ⚠️ لا يعتمد هذا الـ effect على activeConversation.id عمداً — نستخدم
  // activeConversationRef بدلاً منه، حتى لا يُغلق الاتصال ويُعاد فتحه
  // من الصفر (مع فقد حالة الغرف وrejoin) في كل مرة يبدّل المستخدم محادثة
  useEffect(() => {
    if (!user?.id) return;

    const socket = initializeSocket(user.id);
    socketRef.current = socket;

    setConnectionStatus(socket.connected ? "connected" : "connecting");

    socket.on("connect", () => {
      console.log("Socket connected");
      setConnectionStatus("connected");
      // 🔄 عند أول اتصال أو أي إعادة اتصال، نُزامن المحادثات والرسائل
      // فوراً حتى لا تفوت المستخدم أي تحديثات حدثت أثناء الانقطاع
      fetchConversations();
      const current = activeConversationRef.current;
      if (current) {
        socket.emit("read-messages", { conversationId: current.id });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
      setConnectionStatus("disconnected");
    });

    socket.on("reconnect_attempt", () => {
      setConnectionStatus("reconnecting");
    });

    socket.on("online-users", setOnlineUsers);

    socket.on("new-message", (message) => {
      const current = activeConversationRef.current;
      const isActiveConv = current && message.conversationId === current.id;

      if (isActiveConv) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }

      // 🔄 تحديث محلي فوري لآخر رسالة وعدّاد غير المقروء في قائمة
      // المحادثات، بدل عمل نداء API كامل (fetchConversations) لكل رسالة
      // واردة — يقلل الحمل الشبكي بشكل كبير مع محادثات نشطة.
      // إن لم تكن المحادثة موجودة أصلاً في القائمة (محادثة جديدة كلياً
      // لم يفتحها المستخدم من قبل)، نلجأ لـ fetchConversations كاملة.
      let conversationExists = true;
      setConversations((prev) => {
        conversationExists = prev.some((c) => c.id === message.conversationId);
        if (!conversationExists) return prev;
        return prev.map((conv) =>
          conv.id === message.conversationId
            ? {
                ...conv,
                lastMessage: {
                  content: message.content,
                  createdAt: message.createdAt,
                  senderId: message.senderId,
                  senderName: message.senderName,
                },
                unreadCount:
                  isActiveConv || message.senderId === user.id
                    ? conv.unreadCount
                    : (conv.unreadCount || 0) + 1,
              }
            : conv,
        );
      });
      if (!conversationExists) fetchConversations();
    });

    socket.on("typing", ({ conversationId, userId, isTyping: typing }) => {
      const current = activeConversationRef.current;
      if (current?.id === conversationId && userId !== user.id) {
        setIsTyping(typing);
      }
    });

    socket.on("message-status", ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status } : m)),
      );
    });

    socket.on("group-updated", () => {
      fetchConversations();
    });

    socket.on("user-updated", () => {
      fetchConversations();
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      disconnectSocket();
    };
  }, [user?.id, fetchConversations]);

  // التحميل الأولي
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // جلب رسائل المحادثة النشطة (آخر 50 رسالة فقط — انظر handleLoadMoreMessages للأقدم)
  useEffect(() => {
    const fetchMessages = async () => {
      if (!activeConversation) {
        setMessages([]);
        setHasMoreMessages(false);
        return;
      }
      try {
        const response = await api.get(
          `/conversations/${activeConversation.id}/messages`,
        );
        setMessages(response.data.messages);
        setHasMoreMessages(response.data.hasMore);
        socketRef.current?.emit("read-messages", {
          conversationId: activeConversation.id,
        });
      } catch (err) {
        console.error("Error fetching messages:", err);
        if (err.response?.status === 401) {
          setUser(null);
          navigate("/login", { replace: true });
        }
      }
    };
    fetchMessages();
  }, [activeConversation, navigate, setUser]);

  // تحميل رسائل أقدم (يُستدعى عند التمرير لأعلى نافذة المحادثة)
  const handleLoadMoreMessages = useCallback(async () => {
    if (!activeConversation || !hasMoreMessages || loadingMore) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;

    setLoadingMore(true);
    try {
      const response = await api.get(
        `/conversations/${activeConversation.id}/messages`,
        { params: { before: oldestId } },
      );
      setMessages((prev) => [...response.data.messages, ...prev]);
      setHasMoreMessages(response.data.hasMore);
    } catch (err) {
      console.error("Error loading more messages:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [activeConversation, hasMoreMessages, loadingMore, messages]);

  const handleSelectConversation = (conversation) => {
    setActiveConversation(conversation);
  };

  const handleStartConversation = async (selectedUser) => {
    try {
      const response = await api.post("/conversations", {
        participantId: selectedUser.id,
      });
      const conversation = response.data;
      setConversations((prev) => {
        const exists = prev.find((c) => c.id === conversation.id);
        if (exists) return prev;
        return [conversation, ...prev];
      });
      setActiveConversation(conversation);
      setShowUserSearch(false);
    } catch (err) {
      console.error("Error starting conversation:", err);
      if (err.response?.status === 401) {
        setUser(null);
        navigate("/login", { replace: true });
      } else {
        setError("فشل بدء المحادثة");
      }
    }
  };

  const handleGroupCreated = (group) => {
    fetchConversations();
    setTimeout(async () => {
      try {
        const response = await api.get("/conversations");
        const newGroup = response.data.find((c) => c.id === group.id);
        if (newGroup) setActiveConversation(newGroup);
      } catch (err) {
        console.error("Error selecting new group:", err);
      }
    }, 300);
  };

  const handleOpenGroupInfo = (conversation) => {
    if (conversation?.type !== "group") return;
    setGroupInfoId(conversation.id);
    setShowGroupInfo(true);
  };

  const handleGroupUpdated = () => {
    fetchConversations();
  };

  const handleGroupLeft = (groupId) => {
    if (activeConversation?.id === groupId) {
      setActiveConversation(null);
      setMessages([]);
    }
    fetchConversations();
  };

  const handleSendMessage = async (messageData) => {
    if (!activeConversation) return;
    try {
      const response = await api.post("/messages", {
        conversationId: activeConversation.id,
        ...messageData,
      });
      const savedMessage = response.data;

      // ⚠️ لا حاجة لبث الرسالة يدوياً عبر socket هنا — السيرفر يبث
      // "new-message" لكل أعضاء المحادثة (بما فيهم المُرسل نفسه) مباشرة
      // بعد نجاح الحفظ في قاعدة البيانات (routes/messages.js)

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === activeConversation.id
            ? { ...conv, lastMessage: savedMessage }
            : conv,
        ),
      );
    } catch (err) {
      console.error("Error sending message:", err);
      if (err.response?.status === 401) {
        setUser(null);
        navigate("/login", { replace: true });
      } else {
        setError("فشل إرسال الرسالة");
      }
    }
  };

  const handleTyping = (typing) => {
    if (!activeConversation || !socketRef.current) return;
    if (activeConversation.type === "group") return;
    socketRef.current.emit("typing", {
      conversationId: activeConversation.id,
      recipientId: activeConversation.participant?.id,
      isTyping: typing,
    });
  };

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      console.error("Logout error:", err);
    }
    if (socketRef.current) socketRef.current.disconnect();
    setUser(null);
    navigate("/login", { replace: true });
  };

  const handleUserUpdated = (updatedUser) => {
    setUser(updatedUser);
    fetchConversations();
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>جاري تحميل المحادثات...</p>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <Navbar
        user={user}
        setUser={setUser}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfile(true)}
      />

      {(connectionStatus === "disconnected" ||
        connectionStatus === "reconnecting") && (
        <div className="connection-status-banner">
          {connectionStatus === "reconnecting"
            ? "جاري إعادة الاتصال..."
            : "انقطع الاتصال بالخادم. جاري المحاولة..."}
        </div>
      )}
      <div className="chat-layout">
        <div className="sidebar">
          <div className="sidebar-header">
            <button
              className="new-chat-btn"
              onClick={() => setShowUserSearch(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              محادثة
            </button>
            <button
              className="new-group-btn"
              onClick={() => setShowGroupCreate(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              مجموعة
            </button>
          </div>

          <ChatList
            conversations={conversations}
            activeConversation={activeConversation}
            onSelectConversation={handleSelectConversation}
            onlineUsers={onlineUsers}
            currentUserId={user?.id}
          />
        </div>

        <div className="main-chat">
          <ChatWindow
            conversation={activeConversation}
            messages={messages}
            currentUser={user}
            onSendMessage={handleSendMessage}
            onTyping={handleTyping}
            isTyping={isTyping}
            onOpenGroupInfo={handleOpenGroupInfo}
            hasMoreMessages={hasMoreMessages}
            loadingMore={loadingMore}
            onLoadMoreMessages={handleLoadMoreMessages}
          />
        </div>
      </div>

      <Modal
        isOpen={showUserSearch}
        onClose={() => setShowUserSearch(false)}
        title="بحث عن مستخدم"
      >
        <UserSearch
          onStartConversation={handleStartConversation}
          currentUser={user}
        />
      </Modal>

      <GroupCreateModal
        isOpen={showGroupCreate}
        onClose={() => setShowGroupCreate(false)}
        onGroupCreated={handleGroupCreated}
        currentUser={user}
      />

      <GroupInfoModal
        isOpen={showGroupInfo}
        onClose={() => {
          setShowGroupInfo(false);
          setGroupInfoId(null);
        }}
        groupId={groupInfoId}
        currentUser={user}
        onGroupUpdated={handleGroupUpdated}
        onGroupLeft={handleGroupLeft}
      />

      <ProfileModal
        isOpen={showProfile}
        onClose={() => setShowProfile(false)}
        user={user}
        onUserUpdated={handleUserUpdated}
      />

      {error && (
        <div className="error-toast">
          <span>{error}</span>
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
    </div>
  );
}

export default Chat;
