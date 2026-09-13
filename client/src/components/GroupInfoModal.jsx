import React, { useState, useEffect, useRef } from "react";
import api from "../services/api.js";

function GroupInfoModal({
  isOpen,
  onClose,
  groupId,
  currentUser,
  onGroupUpdated,
  onGroupLeft,
}) {
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [showAddMembers, setShowAddMembers] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const searchTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchGroup = async () => {
    if (!groupId) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/groups/${groupId}`);
      setGroup(response.data);
      setNewName(response.data.name);
    } catch (err) {
      console.error("Error fetching group:", err);
      setError("فشل تحميل بيانات المجموعة");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && groupId) {
      fetchGroup();
    }
    if (!isOpen) {
      setShowAddMembers(false);
      setSearchTerm("");
      setSearchResults([]);
      setEditingName(false);
      setGroup(null);
      setError("");
      setSuccess("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, groupId]);

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
        const memberIds = group?.members.map((m) => m.id) || [];
        const filtered = response.data.filter(
          (u) => u.id !== currentUser?.id && !memberIds.includes(u.id),
        );
        setSearchResults(filtered);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchTerm, group, currentUser?.id]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const handleRename = async () => {
    if (!newName.trim() || newName.trim() === group.name) {
      setEditingName(false);
      setNewName(group.name);
      return;
    }

    setSaving(true);
    clearMessages();
    try {
      await api.put(`/groups/${groupId}`, { name: newName.trim() });
      setGroup((prev) => ({ ...prev, name: newName.trim() }));
      setEditingName(false);
      setSuccess("تم تحديث الاسم");
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      console.error("Error renaming:", err);
      setError("فشل تحديث اسم المجموعة");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    clearMessages();

    if (!file.type.startsWith("image/")) {
      setError("يجب اختيار ملف صورة");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("حجم الصورة يجب أن يكون أقل من 5 ميجابايت");
      return;
    }

    setUploadingAvatar(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const response = await api.put(`/groups/${groupId}`, {
            avatar: reader.result,
          });
          setGroup((prev) => ({ ...prev, avatar: response.data.avatar }));
          setSuccess("تم تحديث صورة المجموعة");
          if (onGroupUpdated) onGroupUpdated();
        } catch (err) {
          console.error("Avatar upload error:", err);
          setError(err.response?.data?.message || "فشل تحديث الصورة");
        } finally {
          setUploadingAvatar(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setError("فشل قراءة الملف");
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!window.confirm("هل تريد حذف صورة المجموعة؟")) return;
    clearMessages();
    setUploadingAvatar(true);
    try {
      await api.put(`/groups/${groupId}`, { avatar: null });
      setGroup((prev) => ({ ...prev, avatar: null }));
      setSuccess("تم حذف الصورة");
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      console.error("Remove avatar error:", err);
      setError("فشل حذف الصورة");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleAddMember = async (user) => {
    clearMessages();
    try {
      await api.post(`/groups/${groupId}/members`, { userIds: [user.id] });
      setSearchTerm("");
      setSearchResults([]);
      await fetchGroup();
      setSuccess(`تم إضافة ${user.username}`);
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      console.error("Error adding member:", err);
      setError("فشل إضافة العضو");
    }
  };

  const handleRemoveMember = async (memberId, memberName) => {
    if (!window.confirm(`هل أنت متأكد من إزالة ${memberName} من المجموعة؟`))
      return;
    clearMessages();
    try {
      await api.delete(`/groups/${groupId}/members/${memberId}`);
      await fetchGroup();
      setSuccess("تم إزالة العضو");
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      console.error("Error removing member:", err);
      setError("فشل إزالة العضو");
    }
  };

  const handlePromoteMember = async (memberId, memberName) => {
    if (!window.confirm(`هل تريد ترقية ${memberName} إلى مشرف؟`)) return;
    clearMessages();
    try {
      await api.post(`/groups/${groupId}/promote/${memberId}`);
      await fetchGroup();
      setSuccess(`تم ترقية ${memberName} إلى مشرف`);
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      console.error("Error promoting member:", err);
      if (err.response?.status === 400) {
        setError(err.response.data.message || "لا يمكن ترقية هذا العضو");
      } else {
        setError("فشل ترقية العضو");
      }
    }
  };

  const handleLeave = async () => {
    if (!window.confirm("هل أنت متأكد من مغادرة المجموعة؟")) return;
    try {
      await api.post(`/groups/${groupId}/leave`);
      onClose();
      if (onGroupLeft) onGroupLeft(groupId);
    } catch (err) {
      console.error("Error leaving:", err);
      setError("فشل مغادرة المجموعة");
    }
  };

  if (!isOpen) return null;

  const isAdmin = group?.myRole === "admin";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content group-info-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>معلومات المجموعة</h3>
          <button className="modal-close-btn" onClick={onClose} title="إغلاق">
            ×
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="search-loading">جاري التحميل...</div>
          ) : !group && error ? (
            <div className="auth-error">{error}</div>
          ) : group ? (
            <>
              <div className="group-info-header">
                <div className="profile-avatar-wrapper">
                  {group.avatar ? (
                    <img
                      src={group.avatar}
                      alt="صورة المجموعة"
                      className="group-avatar-large-img"
                    />
                  ) : (
                    <div className="group-avatar-large">
                      {group.name?.charAt(0)?.toUpperCase()}
                    </div>
                  )}
                  {uploadingAvatar && (
                    <div className="avatar-uploading">جاري الرفع...</div>
                  )}
                </div>

                {isAdmin && (
                  <div className="profile-avatar-actions">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarChange}
                      style={{ display: "none" }}
                    />
                    <button
                      className="btn-secondary"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                    >
                      {group.avatar ? "تغيير الصورة" : "رفع صورة"}
                    </button>
                    {group.avatar && (
                      <button
                        className="btn-danger"
                        onClick={handleRemoveAvatar}
                        disabled={uploadingAvatar}
                      >
                        حذف
                      </button>
                    )}
                  </div>
                )}

                {editingName ? (
                  <div className="group-name-edit">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength="100"
                      disabled={saving}
                      autoFocus
                    />
                    <button
                      onClick={handleRename}
                      disabled={saving}
                      className="btn-primary"
                    >
                      حفظ
                    </button>
                    <button
                      onClick={() => {
                        setEditingName(false);
                        setNewName(group.name);
                      }}
                      disabled={saving}
                      className="btn-secondary"
                    >
                      إلغاء
                    </button>
                  </div>
                ) : (
                  <div className="group-name-display">
                    <h2>{group.name}</h2>
                    {isAdmin && (
                      <button
                        onClick={() => setEditingName(true)}
                        className="edit-name-btn"
                        title="تعديل الاسم"
                      >
                        ✏️
                      </button>
                    )}
                  </div>
                )}
                <p className="group-members-count">
                  {group.members.length} عضو
                </p>
              </div>

              {error && <div className="auth-error">{error}</div>}
              {success && <div className="auth-success">{success}</div>}

              <div className="group-members-section">
                <div className="section-header">
                  <h4>الأعضاء</h4>
                  {isAdmin && (
                    <button
                      className="add-member-btn"
                      onClick={() => setShowAddMembers((prev) => !prev)}
                    >
                      {showAddMembers ? "إلغاء" : "+ إضافة عضو"}
                    </button>
                  )}
                </div>

                {showAddMembers && (
                  <div className="add-member-section">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="ابحث عن مستخدم..."
                    />
                    {searching && (
                      <div className="search-loading">جاري البحث...</div>
                    )}
                    {searchResults.length > 0 && (
                      <div className="search-results">
                        {searchResults.map((user) => (
                          <div
                            key={user.id}
                            className="search-result-item"
                            onClick={() => handleAddMember(user)}
                          >
                            <div className="result-avatar">
                              {user.avatar ? (
                                <img
                                  src={user.avatar}
                                  alt=""
                                  className="avatar-img-small"
                                />
                              ) : (
                                user.username?.charAt(0)?.toUpperCase()
                              )}
                            </div>
                            <div className="result-info">
                              <span className="result-name">
                                {user.username}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="members-list">
                  {group.members.map((member) => (
                    <div key={member.id} className="member-item">
                      <div className="member-avatar">
                        {member.avatar ? (
                          <img
                            src={member.avatar}
                            alt=""
                            className="avatar-img-small"
                          />
                        ) : (
                          member.username?.charAt(0)?.toUpperCase()
                        )}
                      </div>
                      <div className="member-info">
                        <span className="member-name">
                          {member.username}
                          {member.id === currentUser?.id && " (أنت)"}
                        </span>
                        {member.role === "admin" && (
                          <span className="admin-badge">مشرف</span>
                        )}
                      </div>

                      {isAdmin && member.id !== currentUser?.id && (
                        <div className="member-actions">
                          {member.role !== "admin" && (
                            <button
                              className="promote-member-btn"
                              onClick={() =>
                                handlePromoteMember(member.id, member.username)
                              }
                              title="ترقية إلى مشرف"
                            >
                              ⭐
                            </button>
                          )}
                          <button
                            className="remove-member-btn"
                            onClick={() =>
                              handleRemoveMember(member.id, member.username)
                            }
                            title="إزالة من المجموعة"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="btn-danger" onClick={handleLeave}>
            مغادرة المجموعة
          </button>
          <button className="btn-secondary" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

export default GroupInfoModal;
