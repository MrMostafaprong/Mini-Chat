import React, { useState, useRef } from "react";

function MessageInput({ onSendMessage, onTyping }) {
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const handleInputChange = (e) => {
    setMessage(e.target.value);

    if (onTyping) {
      onTyping(true);

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 1000);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (message.trim()) {
      onSendMessage({
        type: "text",
        content: message.trim(),
      });
      setMessage("");

      if (onTyping) {
        onTyping(false);
      }
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);

    try {
      const reader = new FileReader();

      reader.onload = () => {
        const fileData = {
          type: file.type.startsWith("image/") ? "image" : "file",
          content: reader.result,
          fileName: file.name,
          fileSize: file.size,
        };

        onSendMessage(fileData);
        setIsUploading(false);
        fileInputRef.current.value = "";
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error uploading file:", error);
      setIsUploading(false);
      fileInputRef.current.value = "";
    }
  };

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <button
        type="button"
        className="attach-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        title="إرفاق ملف"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileUpload}
        style={{ display: "none" }}
        accept="image/*,.pdf,.doc,.docx,.txt"
      />

      <input
        type="text"
        value={message}
        onChange={handleInputChange}
        placeholder="اكتب رسالة..."
        className="message-text-input"
      />

      <button
        type="submit"
        className="send-btn"
        disabled={!message.trim() || isUploading}
        title="إرسال"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </form>
  );
}

export default MessageInput;
