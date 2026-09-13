import React, { useState, useEffect, useRef } from "react";
import api from "../services/api.js";

function UserSearch({
  onStartConversation,
  onStartGroupChat,
  currentUser,
  multiSelect = false,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const searchTimeoutRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (value) => {
    setSearchTerm(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!value.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.get(
          `/users/search?query=${encodeURIComponent(value.trim())}`,
        );
        const filteredResults = response.data.filter(
          (user) =>
            user.id !== currentUser?.id &&
            !selectedUsers.some((s) => s.id === user.id),
        );
        setResults(filteredResults);
        setShowResults(true);
      } catch (error) {
        console.error("Error searching users:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);
  };

  const handleSelectUser = (user) => {
    if (multiSelect) {
      setSelectedUsers((prev) => [...prev, user]);
      setSearchTerm("");
      setResults([]);
      setShowResults(false);
    } else {
      onStartConversation(user);
      setSearchTerm("");
      setResults([]);
      setShowResults(false);
    }
  };

  const handleRemoveSelected = (userId) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const handleConfirm = () => {
    if (selectedUsers.length === 0) return;
    if (onStartGroupChat) {
      onStartGroupChat(selectedUsers);
    }
    setSelectedUsers([]);
    setSearchTerm("");
    setResults([]);
  };

  return (
    <div className="user-search" ref={searchRef}>
      <div className="search-input-wrapper">
        <input
          type="text"
          placeholder={
            multiSelect ? "ابحث لإضافة أعضاء..." : "ابحث عن مستخدم..."
          }
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => searchTerm.trim() && setShowResults(true)}
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

      {multiSelect && selectedUsers.length > 0 && (
        <div className="selected-users-section">
          <div className="selected-users-label">
            المختارون ({selectedUsers.length}):
          </div>
          <div className="selected-users-chips">
            {selectedUsers.map((user) => (
              <div key={user.id} className="selected-user-chip">
                <div className="chip-avatar">
                  {user.username?.charAt(0)?.toUpperCase()}
                </div>
                <span>{user.username}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveSelected(user.id)}
                  title="إزالة"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showResults && (
        <div className="search-results">
          {loading ? (
            <div className="search-loading">جاري البحث...</div>
          ) : results.length === 0 ? (
            <div className="no-results">لا توجد نتائج</div>
          ) : (
            results.map((user) => (
              <div
                key={user.id}
                className="search-result-item"
                onClick={() => handleSelectUser(user)}
              >
                <div className="result-avatar">
                  {user.username?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div className="result-info">
                  <span className="result-name">{user.username}</span>
                </div>
                <button
                  className="start-chat-btn"
                  title={multiSelect ? "إضافة" : "بدء محادثة"}
                >
                  {multiSelect ? (
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
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {multiSelect && selectedUsers.length > 0 && (
        <button className="confirm-multi-select-btn" onClick={handleConfirm}>
          متابعة ({selectedUsers.length})
        </button>
      )}
    </div>
  );
}

export default UserSearch;
