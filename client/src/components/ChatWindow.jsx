import React, { useEffect, useRef } from "react";
import Message from "./Message.jsx";
import MessageInput from "./MessageInput.jsx";

function ChatWindow({
  conversation,
  messages,
  currentUser,
  onSendMessage,
  onTyping,
  isTyping,
  onOpenGroupInfo,
}) {
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  if (!conversation) {
    return (
      <div className="chat-window empty">
        <div className="empty-chat-icon">💬</div>
        <h2>اختر محادثة</h2>
        <p>اختر محادثة من القائمة أو ابحث عن مستخدم للبدء</p>
      </div>
    );
  }

  const isGroup = conversation.type === "group";

  const getHeaderTitle = () => {
    if (isGroup) return conversation.name || "مجموعة";
    return conversation.participant?.username || "مستخدم";
  };

  const getHeaderSubtitle = () => {
    if (isGroup) return `${conversation.memberCount || 0} عضو`;
    if (isTyping) return "يكتب الآن...";
    return "متصل";
  };

  const getAvatarContent = () => {
    if (isGroup) {
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

  const handleHeaderClick = () => {
    if (isGroup && onOpenGroupInfo) onOpenGroupInfo(conversation);
  };

  return (
    <div className="chat-window">
      <div
        className={`chat-header ${isGroup ? "clickable" : ""}`}
        onClick={handleHeaderClick}
        title={isGroup ? "عرض معلومات المجموعة" : ""}
      >
        <div className="chat-header-user">
          <div
            className={`conversation-avatar ${isGroup ? "group-avatar" : ""}`}
          >
            {getAvatarContent()}
          </div>
          <div className="chat-header-info">
            <h3>{getHeaderTitle()}</h3>
            <span
              className={
                isTyping && !isGroup ? "typing-status" : "online-status"
              }
            >
              {getHeaderSubtitle()}
            </span>
          </div>
        </div>
        {isGroup && (
          <div className="chat-header-actions">
            <button
              className="group-info-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleHeaderClick();
              }}
              title="معلومات المجموعة"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="no-messages">
            <p>لا توجد رسائل</p>
            <span>قل مرحباً! 👋</span>
          </div>
        ) : (
          messages.map((message, index) => (
            <Message
              key={message.id || index}
              message={message}
              isOwnMessage={message.senderId === currentUser?.id}
              showDate={
                index === 0 ||
                new Date(message.createdAt).toDateString() !==
                  new Date(messages[index - 1].createdAt).toDateString()
              }
              isGroup={isGroup}
            />
          ))
        )}

        {isTyping && !isGroup && (
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <MessageInput onSendMessage={onSendMessage} onTyping={onTyping} />
    </div>
  );
}

export default ChatWindow;
