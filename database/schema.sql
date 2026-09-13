-- =====================================================================
-- MiniChat Database Schema
-- يطابق هذا الملف بالكامل الاستعلامات الفعلية المستخدمة في كود السيرفر
-- (routes/*, middleware/auth.js, socket.js)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- =====================================================================
-- users
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    username       VARCHAR(30) NOT NULL UNIQUE,
    email          CITEXT      NOT NULL UNIQUE,
    password       VARCHAR(255) NOT NULL,
    avatar         TEXT,
    token_version  INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_username_length CHECK (LENGTH(username) BETWEEN 3 AND 30),
    CONSTRAINT chk_username_chars  CHECK (username ~ '^[a-zA-Z0-9\u0600-\u06FF\s]+$'),
    CONSTRAINT chk_email_length    CHECK (LENGTH(email::text) <= 100),
    CONSTRAINT chk_password_length CHECK (LENGTH(password) >= 60)
);

CREATE INDEX idx_users_username ON users (LOWER(username));
CREATE INDEX idx_users_email    ON users (LOWER(email));

-- =====================================================================
-- login_attempts
-- تتبّع محاولات الدخول الفاشلة لقفل الحساب مؤقتاً بعد 5 محاولات / 15 دقيقة
-- =====================================================================
CREATE TABLE IF NOT EXISTS login_attempts (
    id           SERIAL PRIMARY KEY,
    email        CITEXT NOT NULL,
    ip_address   VARCHAR(45),
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_email_time
    ON login_attempts (email, attempted_at);

-- =====================================================================
-- conversations
-- يخدم كلاً من المحادثات الخاصة (private) والمجموعات (group) في نفس الجدول
--   - private: user1_id/user2_id مطلوبان (user1_id < user2_id)، name/avatar/created_by فارغة
--   - group:   name مطلوب، user1_id/user2_id فارغان
-- =====================================================================
CREATE TABLE IF NOT EXISTS conversations (
    id         SERIAL PRIMARY KEY,
    type       VARCHAR(10) NOT NULL DEFAULT 'private',
    user1_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    user2_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(100),
    avatar     TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_conversation_type CHECK (type IN ('private', 'group')),
    CONSTRAINT chk_user_order CHECK (user1_id IS NULL OR user2_id IS NULL OR user1_id < user2_id),
    CONSTRAINT chk_private_has_users CHECK (
        type <> 'private' OR (user1_id IS NOT NULL AND user2_id IS NOT NULL)
    ),
    CONSTRAINT chk_group_has_name CHECK (
        type <> 'group' OR (name IS NOT NULL AND LENGTH(name) BETWEEN 1 AND 100)
    )
);

-- زوج المحادثة الخاصة فريد فقط لمحادثات النوع private (user1_id/user2_id تكون NULL للمجموعات)
CREATE UNIQUE INDEX uq_conversation_pair
    ON conversations (user1_id, user2_id)
    WHERE type = 'private';

CREATE INDEX idx_conversations_user1 ON conversations (user1_id);
CREATE INDEX idx_conversations_user2 ON conversations (user2_id);
CREATE INDEX idx_conversations_created_by ON conversations (created_by);

-- =====================================================================
-- conversation_members
-- عضوية كل مستخدم في كل محادثة (خاصة أو مجموعة) بدورها (admin/member)
-- =====================================================================
CREATE TABLE IF NOT EXISTS conversation_members (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(10) NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_member_role CHECK (role IN ('admin', 'member')),
    CONSTRAINT uq_conversation_member UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conversation_members_conversation ON conversation_members (conversation_id);
CREATE INDEX idx_conversation_members_user ON conversation_members (user_id);

-- =====================================================================
-- messages
-- ⚠️ حد المحتوى 7,000,000 حرف (وليس 5000) لأن النصوص من نوع image/file
--    تحمل بيانات base64 حتى ~5MB قبل الترميز (routes/messages.js)
-- =====================================================================
CREATE TABLE IF NOT EXISTS messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    type            VARCHAR(10) NOT NULL DEFAULT 'text',
    status          VARCHAR(10) NOT NULL DEFAULT 'sent',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_message_type   CHECK (type IN ('text', 'image', 'file')),
    CONSTRAINT chk_message_status CHECK (status IN ('sent', 'delivered', 'read')),
    CONSTRAINT chk_content_length CHECK (LENGTH(content) BETWEEN 1 AND 7000000)
);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_sender ON messages (sender_id);
CREATE INDEX idx_messages_status ON messages (status) WHERE status != 'read';

-- =====================================================================
-- Triggers: updated_at التلقائي
-- =====================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
