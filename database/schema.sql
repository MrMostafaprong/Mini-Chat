CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(30) NOT NULL UNIQUE,
    email         CITEXT     NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_username_length CHECK (LENGTH(username) BETWEEN 3 AND 30),
    CONSTRAINT chk_username_chars  CHECK (username ~ '^[a-zA-Z0-9\u0600-\u06FF\s]+$'),
    CONSTRAINT chk_email_length    CHECK (LENGTH(email::text) <= 100),
    CONSTRAINT chk_password_length CHECK (LENGTH(password) >= 60)
);

CREATE INDEX idx_users_username ON users (LOWER(username));
CREATE INDEX idx_users_email    ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS conversations (
    id         SERIAL PRIMARY KEY,
    user1_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user2_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_user_order CHECK (user1_id < user2_id),
    CONSTRAINT uq_conversation_pair UNIQUE (user1_id, user2_id)
);

CREATE INDEX idx_conversations_user1 ON conversations (user1_id);
CREATE INDEX idx_conversations_user2 ON conversations (user2_id);

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
    CONSTRAINT chk_content_length CHECK (LENGTH(content) BETWEEN 1 AND 5000)
);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_sender ON messages (sender_id);
CREATE INDEX idx_messages_status ON messages (status) WHERE status != 'read';

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