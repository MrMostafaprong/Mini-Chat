import React from 'react'

function Message({ message, isOwnMessage, showDate, isGroup }) {
  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    
    const date = new Date(timestamp)
    return date.toLocaleTimeString('ar-EG', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return ''
    
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'اليوم'
    if (diffDays === 1) return 'أمس'
    
    return date.toLocaleDateString('ar-EG', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const getMessageStatus = () => {
    if (!isOwnMessage) return null
    
    switch (message.status) {
      case 'sent':
        return '✓'
      case 'delivered':
        return '✓✓'
      case 'read':
        return <span className="read-status">✓✓</span>
      default:
        return '✓'
    }
  }

  // اختيار لون ثابت لاسم المرسل في المجموعات
  const getSenderColor = (name) => {
    if (!name) return '#667781'
    const colors = [
      '#e57373', '#f06292', '#ba68c8', '#9575cd', 
      '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', 
      '#4db6ac', '#81c784', '#aed581', '#ffb74d',
      '#ff8a65', '#a1887f', '#90a4ae'
    ]
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  return (
    <>
      {showDate && (
        <div className="message-date-separator">
          <span>{formatDate(message.createdAt)}</span>
        </div>
      )}
      
      <div className={`message-wrapper ${isOwnMessage ? 'own-message' : 'other-message'}`}>
        <div className="message-bubble">
          {isGroup && !isOwnMessage && message.senderName && (
            <div 
              className="message-sender-name"
              style={{ color: getSenderColor(message.senderName) }}
            >
              {message.senderName}
            </div>
          )}
          
          {message.type === 'text' ? (
            <p className="message-content">{message.content}</p>
          ) : message.type === 'image' ? (
            <img 
              src={message.content} 
              alt="صورة" 
              className="message-image"
              onClick={() => window.open(message.content, '_blank')}
            />
          ) : message.type === 'file' ? (
            <a 
              href={message.content} 
              download
              className="message-file"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span>تحميل الملف</span>
            </a>
          ) : null}
          
          <div className="message-meta">
            <span className="message-time">{formatTime(message.createdAt)}</span>
            {getMessageStatus()}
          </div>
        </div>
      </div>
    </>
  )
}

export default Message