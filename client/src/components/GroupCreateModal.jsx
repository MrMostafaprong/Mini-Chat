import React, { useState, useEffect, useRef } from "react";
import api from "../services/api.js";

function GroupCreateModal({ isOpen, onClose, onGroupCreated, currentUser }) {
  const [name, setName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setSearchTerm("");
      setSearchResults([]);
      setSelectedMembers([]);
      setError("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.get(
          `/users/search?query=${encodeURIComponent(searchTerm.trim())}`,
        );
        const filtered = response.data.filter(
          (u) =>
            u.id !== currentUser?.id &&
            !selectedMembers.some((m) => m.id === u.id),
        );
        setSearchResults(filtered);
      } catch (err) {
        console.error("Search error:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm, currentUser?.id, selectedMembers]);

  const handleAddMember = (user) => {
    setSelectedMembers((prev) => [...prev, user]);
    setSearchResults((prev) => prev.filter((u) => u.id !== user.id));
    setSearchTerm("");
  };

  const handleRemoveMember = (userId) => {
    setSelectedMembers((prev) => prev.filter((u) => u.id !== userId));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("اسم المجموعة مطلوب");
      return;
    }

    if (name.trim().length > 100) {
      setError("اسم المجموعة يجب أن يكون 100 حرف أو أقل");
      return;
    }

    if (selectedMembers.length === 0) {
      setError("يجب اختيار عضو واحد على الأقل");
      return;
    }

    setCreating(true);
    try {
      const response = await api.post("/groups", {
        name: name.trim(),
        memberIds: selectedMembers.map((m) => m.id),
      });
      onGroupCreated(response.data);
      onClose();
    } catch (err) {
      console.error("Error creating group:", err);
      if (err.response?.status === 400) {
        setError(err.response.data.message || "بيانات غير صالحة");
      } else {
        setError("فشل إنشاء المجموعة");
      }
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content group-create-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>إنشاء مجموعة جديدة</h3>
          <button className="modal-close-btn" onClick={onClose} title="إغلاق">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="auth-error" role="alert">
                <span>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="group-name">اسم المجموعة</label>
              <input
                type="text"
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: أصدقاء العمل"
                maxLength="100"
                disabled={creating}
              />
            </div>

            <div className="form-group">
              <label>إضافة أعضاء</label>
              <div className="search-input-wrapper">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ابحث عن مستخدم..."
                  disabled={creating}
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

              {searching && <div className="search-loading">جاري البحث...</div>}

              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      className="search-result-item"
                      onClick={() => handleAddMember(user)}
                    >
                      <div className="result-avatar">
                        {user.username?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="result-info">
                        <span className="result-name">{user.username}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedMembers.length > 0 && (
              <div className="form-group">
                <label>الأعضاء المختارون ({selectedMembers.length})</label>
                <div className="selected-members">
                  {selectedMembers.map((member) => (
                    <div key={member.id} className="selected-member-chip">
                      <div className="chip-avatar">
                        {member.username?.charAt(0)?.toUpperCase()}
                      </div>
                      <span>{member.username}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member.id)}
                        disabled={creating}
                        title="إزالة"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="btn-secondary"
            >
              إلغاء
            </button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? "جاري الإنشاء..." : "إنشاء المجموعة"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default GroupCreateModal;
