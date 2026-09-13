import React, { useState, useEffect, useRef } from "react";
import api from "../services/api.js";

function ProfileModal({ isOpen, onClose, user, onUserUpdated }) {
  const [activeTab, setActiveTab] = useState("info");
  const [email, setEmail] = useState("");
  const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen && user) {
      setEmail(user.email || "");
      setAvatar(user.avatar || null);
      setCurrentPassword("");
      setCurrentPasswordForEmail("");
      setNewPassword("");
      setConfirmPassword("");
      setError("");
      setSuccess("");
      setActiveTab("info");
    }
  }, [isOpen, user]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!email.trim()) {
      setError("البريد الإلكتروني مطلوب");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("البريد الإلكتروني غير صالح");
      return;
    }

    // إذا لم يتغير البريد، لا نفعل شيء
    if (email.trim().toLowerCase() === (user.email || "").toLowerCase()) {
      setSuccess("لا يوجد تغيير في البريد الإلكتروني");
      return;
    }

    // 🔒 طلب كلمة المرور الحالية
    if (!currentPasswordForEmail) {
      setError("لحماية حسابك، أدخل كلمة المرور الحالية");
      return;
    }

    setLoading(true);
    try {
      const response = await api.put("/users/profile", {
        email: email.trim().toLowerCase(),
        currentPassword: currentPasswordForEmail,
      });

      const updatedUser = response.data.user;
      setSuccess("تم تحديث البريد الإلكتروني بنجاح");
      setCurrentPasswordForEmail("");

      if (onUserUpdated) onUserUpdated({ ...user, ...updatedUser });
    } catch (err) {
      console.error("Update profile error:", err);
      if (err.response?.status === 401) {
        setError("كلمة المرور الحالية غير صحيحة");
      } else if (err.response?.status === 409) {
        setError("تعذر تحديث البيانات");
      } else if (err.response?.status === 400) {
        setError(err.response.data.message || "بيانات غير صالحة");
      } else {
        setError("فشل تحديث الملف الشخصي");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("جميع الحقول مطلوبة");
      return;
    }

    if (newPassword.length < 8) {
      setError("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل");
      return;
    }

    if (!/[A-Z]/.test(newPassword)) {
      setError("كلمة المرور يجب أن تحتوي على حرف كبير (A-Z)");
      return;
    }

    if (!/[a-z]/.test(newPassword)) {
      setError("كلمة المرور يجب أن تحتوي على حرف صغير (a-z)");
      return;
    }

    if (!/\d/.test(newPassword)) {
      setError("كلمة المرور يجب أن تحتوي على رقم");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("كلمتا المرور الجديدتان غير متطابقتين");
      return;
    }

    setLoading(true);
    try {
      const response = await api.put("/users/profile", {
        currentPassword,
        newPassword,
      });

      if (response.data.sessionsRevoked) {
        setSuccess(
          "تم تغيير كلمة المرور بنجاح. تم إنهاء الجلسات الأخرى على أجهزة أخرى.",
        );
      } else {
        setSuccess("تم تغيير كلمة المرور بنجاح");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error("Change password error:", err);
      if (err.response?.status === 401) {
        setError("كلمة المرور الحالية غير صحيحة");
      } else if (err.response?.status === 400) {
        setError(err.response.data.message || "بيانات غير صالحة");
      } else {
        setError("فشل تغيير كلمة المرور");
      }
    } finally {
      setLoading(false);
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

    // 🔒 رفض SVG
    if (file.type === "image/svg+xml") {
      setError("صور SVG غير مسموحة لأسباب أمنية");
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
          const response = await api.put("/users/avatar", {
            avatar: reader.result,
          });

          const updatedUser = response.data.user;
          setAvatar(updatedUser.avatar);
          setSuccess("تم تحديث الصورة بنجاح");

          if (onUserUpdated) onUserUpdated({ ...user, ...updatedUser });
        } catch (err) {
          console.error("Avatar upload error:", err);
          if (err.response?.status === 400) {
            setError(err.response.data.message || "صورة غير صالحة");
          } else {
            setError("فشل تحديث الصورة");
          }
        } finally {
          setUploadingAvatar(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };

      reader.onerror = () => {
        setError("فشل قراءة الملف");
        setUploadingAvatar(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error("File read error:", err);
      setError("فشل قراءة الملف");
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    if (!window.confirm("هل تريد حذف صورتك الحالية؟")) return;

    clearMessages();
    setUploadingAvatar(true);
    try {
      await api.put("/users/avatar", { avatar: null });
      setAvatar(null);
      setSuccess("تم حذف الصورة");
      if (onUserUpdated) onUserUpdated({ ...user, avatar: null });
    } catch (err) {
      console.error("Remove avatar error:", err);
      setError("فشل حذف الصورة");
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content profile-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>الملف الشخصي</h3>
          <button className="modal-close-btn" onClick={onClose} title="إغلاق">
            ×
          </button>
        </div>

        <div className="profile-header">
          <div className="profile-avatar-wrapper">
            {avatar ? (
              <img
                src={avatar}
                alt="الصورة الشخصية"
                className="profile-avatar-img"
              />
            ) : (
              <div className="profile-avatar-placeholder">
                {user?.username?.charAt(0)?.toUpperCase() || "U"}
              </div>
            )}
            {uploadingAvatar && (
              <div className="avatar-uploading">جاري الرفع...</div>
            )}
          </div>

          <div className="profile-avatar-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              onChange={handleAvatarChange}
              style={{ display: "none" }}
            />
            <button
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              {avatar ? "تغيير الصورة" : "رفع صورة"}
            </button>
            {avatar && (
              <button
                className="btn-danger"
                onClick={handleRemoveAvatar}
                disabled={uploadingAvatar}
              >
                حذف
              </button>
            )}
          </div>

          <h2 className="profile-username">{user?.username}</h2>
        </div>

        <div className="profile-tabs">
          <button
            className={`profile-tab ${activeTab === "info" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("info");
              clearMessages();
            }}
          >
            المعلومات
          </button>
          <button
            className={`profile-tab ${activeTab === "password" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("password");
              clearMessages();
            }}
          >
            كلمة المرور
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}

          {activeTab === "info" && (
            <form onSubmit={handleUpdateProfile} className="profile-form">
              <div className="form-group">
                <label htmlFor="profile-username">اسم المستخدم</label>
                <input
                  type="text"
                  id="profile-username"
                  value={user?.username || ""}
                  disabled
                  className="disabled-input"
                />
                <small className="form-hint">لا يمكن تغيير اسم المستخدم</small>
              </div>

              <div className="form-group">
                <label htmlFor="profile-email">البريد الإلكتروني</label>
                <input
                  type="email"
                  id="profile-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  maxLength="100"
                  autoComplete="email"
                />
              </div>

              {email.trim().toLowerCase() !==
                (user?.email || "").toLowerCase() && (
                <div className="form-group">
                  <label htmlFor="current-password-for-email">
                    كلمة المرور الحالية
                  </label>
                  <input
                    type="password"
                    id="current-password-for-email"
                    value={currentPasswordForEmail}
                    onChange={(e) => setCurrentPasswordForEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="current-password"
                  />
                  <small className="form-hint">
                    مطلوبة لتأكيد تغيير البريد الإلكتروني
                  </small>
                </div>
              )}

              <div className="modal-footer">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading ? "جاري الحفظ..." : "حفظ التغييرات"}
                </button>
              </div>
            </form>
          )}

          {activeTab === "password" && (
            <form onSubmit={handleChangePassword} className="profile-form">
              <div className="form-group">
                <label htmlFor="current-password">كلمة المرور الحالية</label>
                <input
                  type="password"
                  id="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-password">كلمة المرور الجديدة</label>
                <input
                  type="password"
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  minLength="8"
                  maxLength="128"
                />
                <small className="form-hint">
                  8 أحرف على الأقل، مع حرف كبير وحرف صغير ورقم
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="confirm-password">
                  تأكيد كلمة المرور الجديدة
                </label>
                <input
                  type="password"
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  minLength="8"
                  maxLength="128"
                />
              </div>

              <div className="modal-footer">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading ? "جاري التغيير..." : "تغيير كلمة المرور"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileModal;
