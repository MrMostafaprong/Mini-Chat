import React from "react";

function Navbar({ user, setUser, onOpenProfile, onLogout }) {
  // ⚠️ استدعاء /auth/logout الفعلي وتنظيف الحالة يتمّان في Chat.jsx
  // (لتفادي استدعاء الـ endpoint مرتين عند كل تسجيل خروج)
  const handleLogoutClick = () => {
    if (onLogout) onLogout();
  };

  const handleAvatarClick = () => {
    if (onOpenProfile) onOpenProfile();
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="navbar-logo">💬</span>
        <span className="navbar-title">MiniChat</span>
      </div>

      <div className="navbar-user">
        <button
          className="navbar-user-info"
          onClick={handleAvatarClick}
          title="الملف الشخصي"
        >
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt="الصورة الشخصية"
              className="navbar-avatar-img"
            />
          ) : (
            <div className="user-avatar">
              {user?.username?.charAt(0)?.toUpperCase() || "U"}
            </div>
          )}
          <span className="user-name">{user?.username}</span>
        </button>
        <button
          className="logout-btn"
          onClick={handleLogoutClick}
          title="تسجيل الخروج"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

export default Navbar;
