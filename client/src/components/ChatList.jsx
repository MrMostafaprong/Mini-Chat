import React, { useState } from "react";

function ChatList({
  conversations,
  activeConversation,
  onSelectConversation,
  onlineUsers,
  currentUserId,
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const getDisplayName = (conversation) => {
    if (conversation.type === "group") return conversation.name || "مجموعة";
    return conversation.participant?.username || "مستخدم";
  };

  const getAvatarContent = (conversation) => {
    if (conversation.type === "group") {
      if (conversation.avatar) {
        return <img src={conversation.avatar} alt="" />;
      }
      return "👥";
    }
    if (conversation.participant?.avatar) {
      return <img src={conversation.participant.avatar} alt="" />;
    }
    return conversation.participant?.username?.charAt(0)?.toUpperCase() || "U";
  };

  const isUserOnline = (conversation) => {
    if (conversation.type === "group") return false;
    return onlineUsers?.includes(conversation.participant?.id);
  };

  const filteredConversations = conversations.filter((conversation) => {
    const name = getDisplayName(conversation).toLowerCase();
    const lastMessage = conversation.lastMessage?.content?.toLowerCase() || "";
    const search = searchTerm.toLowerCase();
    return name.includes(search) || lastMessage.includes(search);
  });

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      return date.toLocaleTimeString("ar-EG", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (diffDays === 1) return "أمس";
    if (diffDays < 7)
      return date.toLocaleDateString("ar-EG", { weekday: "long" });
    return date.toLocaleDateString("ar-EG");
  };

  const renderLastMessage = (conversation) => {
    const lastMessage = conversation.lastMessage;
    if (!lastMessage) return "ابدأ المحادثة";

    const isOwn = lastMessage.senderId === currentUserId;
    const isGroup = conversation.type === "group";

    let messageText = lastMessage.content;
    if (lastMessage.type === "image") messageText = "📷 صورة";
    else if (lastMessage.type === "file") messageText = "📎 ملف";

    if (isGroup) {
      if (isOwn) return `أنت: ${messageText}`;
      if (lastMessage.senderName)
        return `${lastMessage.senderName}: ${messageText}`;
    }
    return messageText;
  };

  return (
    <div className="chat-list">
      <div className="chat-list-header">
        <h2>المحادثات</h2>
        <div className="search-box">
          <input
            type="text"
            placeholder="بحث في المحادثات..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>

      <div className="conversations-list">
        {filteredConversations.length === 0 ? (
          <div className="no-conversations">
            <p>لا توجد محادثات</p>
            <span>ابدأ محادثة جديدة أو أنشئ مجموعة</span>
          </div>
        ) : (
          filteredConversations.map((conversation) => {
            const isActive = activeConversation?.id === conversation.id;
            const isGroup = conversation.type === "group";
            const online = isUserOnline(conversation);

            return (
              <div
                key={conversation.id}
                className={`conversation-item ${isActive ? "active" : ""}`}
                onClick={() => onSelectConversation(conversation)}
              >
                <div
                  className={`conversation-avatar ${isGroup ? "group-avatar" : ""}`}
                >
                  {getAvatarContent(conversation)}
                  {online && <span className="online-indicator"></span>}
                </div>

                <div className="conversation-info">
                  <div className="conversation-top">
                    <h3>
                      {getDisplayName(conversation)}
                      {isGroup && conversation.memberCount > 0 && (
                        <span className="member-count">
                          {" "}
                          ({conversation.memberCount})
                        </span>
                      )}
                    </h3>
                    <span className="conversation-time">
                      {formatTime(conversation.lastMessage?.createdAt)}
                    </span>
                  </div>

                  <div className="conversation-bottom">
                    <p className="last-message">
                      {renderLastMessage(conversation)}
                    </p>
                    {conversation.unreadCount > 0 && (
                      <span className="unread-badge">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ChatList;
