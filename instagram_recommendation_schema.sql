-- Recommendation-ready schema for the Instagram clone.
-- This keeps embeddings as DOUBLE PRECISION[] so it remains compatible with the
-- existing Node.js backend, while still exposing a clean text corpus for
-- TF-IDF, cosine similarity, or a future pgvector migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'post_category'
    ) THEN
        CREATE TYPE post_category AS ENUM (
            'Gaming',
            'Army/Military',
            'News',
            'Funny Memes',
            'Tech',
            'Poetry',
            'Graphic Design'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password TEXT NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    otp_code VARCHAR(16),
    otp_expires_at TIMESTAMPTZ,
    profile_pic TEXT,
    bio TEXT,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notifications_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    interest_embedding DOUBLE PRECISION[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_pic TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS interest_embedding DOUBLE PRECISION[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS follows (
    id BIGSERIAL PRIMARY KEY,
    follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'accepted',
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('pending', 'accepted'))
);

ALTER TABLE follows ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'accepted';
ALTER TABLE follows ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE follows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE follows
SET accepted_at = COALESCE(accepted_at, created_at)
WHERE status = 'accepted';

CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category post_category,
    caption TEXT NOT NULL DEFAULT '',
    share_count INTEGER NOT NULL DEFAULT 0,
    hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    language_code VARCHAR(8) NOT NULL DEFAULT 'en',
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    embedding DOUBLE PRECISION[],
    ocr_text TEXT NOT NULL DEFAULT '',
    vision_caption TEXT NOT NULL DEFAULT '',
    vision_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    analysis_text TEXT NOT NULL DEFAULT '',
    analysis_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    analysis_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content_text TEXT NOT NULL DEFAULT '',
    content_tsv TSVECTOR
);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS category post_category;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE posts ADD COLUMN IF NOT EXISTS language_code VARCHAR(8) NOT NULL DEFAULT 'en';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS embedding DOUBLE PRECISION[];
ALTER TABLE posts ADD COLUMN IF NOT EXISTS ocr_text TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS vision_caption TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS vision_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE posts ADD COLUMN IF NOT EXISTS analysis_text TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS analysis_status VARCHAR(24) NOT NULL DEFAULT 'pending';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS analysis_updated_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_tsv TSVECTOR;

CREATE TABLE IF NOT EXISTS post_images (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE post_images ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS likes (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    text_tsv TSVECTOR
);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE comments ADD COLUMN IF NOT EXISTS text_tsv TSVECTOR;

CREATE TABLE IF NOT EXISTS comment_likes (
    id BIGSERIAL PRIMARY KEY,
    comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE comment_likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS stories (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS story_likes (
    id BIGSERIAL PRIMARY KEY,
    story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE story_likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS story_comments (
    id BIGSERIAL PRIMARY KEY,
    story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE story_comments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE story_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS saved_posts (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE saved_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS post_interest_feedback (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feedback VARCHAR(24) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (feedback IN ('interested', 'not_interested'))
);

ALTER TABLE post_interest_feedback ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE post_interest_feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS user_searches (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    normalized_query TEXT NOT NULL,
    matched_category post_category,
    matched_hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    results_count INTEGER NOT NULL DEFAULT 0,
    result_post_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
    clicked_post_id BIGINT REFERENCES posts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    query_tsv TSVECTOR
);

ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS normalized_query TEXT NOT NULL DEFAULT '';
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS matched_category post_category;
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS matched_hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS results_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS result_post_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[];
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS clicked_post_id BIGINT;
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_searches ADD COLUMN IF NOT EXISTS query_tsv TSVECTOR;

CREATE UNIQUE INDEX IF NOT EXISTS ux_follows_follower_following
    ON follows (follower_id, following_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_likes_post_user
    ON likes (post_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_saved_posts_post_user
    ON saved_posts (post_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_comment_likes_comment_user
    ON comment_likes (comment_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_story_likes_story_user
    ON story_likes (story_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_post_interest_feedback_post_user
    ON post_interest_feedback (post_id, user_id);

CREATE INDEX IF NOT EXISTS idx_follows_following_status
    ON follows (following_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_accepted_at
    ON follows (following_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_created_at
    ON posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category_created_at
    ON posts (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_hashtags_gin
    ON posts USING GIN (hashtags);
CREATE INDEX IF NOT EXISTS idx_posts_content_tsv
    ON posts USING GIN (content_tsv);
CREATE INDEX IF NOT EXISTS idx_post_images_post_id
    ON post_images (post_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_likes_user_created_at
    ON likes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_created_at
    ON comments (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent_comment_created_at
    ON comments (parent_comment_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_user_created_at
    ON comments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_text_tsv
    ON comments USING GIN (text_tsv);
CREATE INDEX IF NOT EXISTS idx_stories_user_created_at
    ON stories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_comments_story_created_at
    ON story_comments (story_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_story_likes_story_created_at
    ON story_likes (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_posts_user_created_at
    ON saved_posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_interest_feedback_user_updated_at
    ON post_interest_feedback (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_searches_user_created_at
    ON user_searches (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_searches_normalized_query
    ON user_searches (normalized_query);
CREATE INDEX IF NOT EXISTS idx_user_searches_query_tsv
    ON user_searches USING GIN (query_tsv);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm
    ON users USING GIN (username gin_trgm_ops);

CREATE OR REPLACE FUNCTION cosine_similarity(a DOUBLE PRECISION[], b DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION AS $$
DECLARE
    dot_product DOUBLE PRECISION := 0;
    norm_a DOUBLE PRECISION := 0;
    norm_b DOUBLE PRECISION := 0;
    i INTEGER;
BEGIN
    IF a IS NULL
       OR b IS NULL
       OR array_length(a, 1) IS NULL
       OR array_length(b, 1) IS NULL
       OR array_length(a, 1) <> array_length(b, 1) THEN
        RETURN 0;
    END IF;

    FOR i IN 1..array_length(a, 1) LOOP
        dot_product := dot_product + (a[i] * b[i]);
        norm_a := norm_a + (a[i] * a[i]);
        norm_b := norm_b + (b[i] * b[i]);
    END LOOP;

    IF norm_a = 0 OR norm_b = 0 THEN
        RETURN 0;
    END IF;

    RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION sync_post_recommendation_fields()
RETURNS TRIGGER AS $$
BEGIN
    NEW.content_text := trim(
        BOTH ' '
        FROM COALESCE(NEW.category::TEXT, '')
        || ' '
        || COALESCE(NEW.caption, '')
        || ' '
        || COALESCE(NEW.ocr_text, '')
        || ' '
        || COALESCE(NEW.vision_caption, '')
        || ' '
        || array_to_string(COALESCE(NEW.vision_labels, ARRAY[]::TEXT[]), ' ')
        || ' '
        || COALESCE(NEW.analysis_text, '')
        || ' '
        || array_to_string(COALESCE(NEW.hashtags, ARRAY[]::TEXT[]), ' ')
    );
    NEW.content_tsv := to_tsvector('english', COALESCE(NEW.content_text, ''));
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_comment_search_fields()
RETURNS TRIGGER AS $$
BEGIN
    NEW.text_tsv := to_tsvector('english', COALESCE(NEW.text, ''));
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_user_search_fields()
RETURNS TRIGGER AS $$
BEGIN
    NEW.normalized_query := lower(trim(regexp_replace(COALESCE(NEW.query_text, ''), '\s+', ' ', 'g')));
    NEW.query_tsv := to_tsvector(
        'english',
        trim(
            BOTH ' '
            FROM COALESCE(NEW.query_text, '')
            || ' '
            || COALESCE(NEW.matched_category::TEXT, '')
            || ' '
            || array_to_string(COALESCE(NEW.matched_hashtags, ARRAY[]::TEXT[]), ' ')
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posts_sync_recommendation_fields ON posts;
CREATE TRIGGER trg_posts_sync_recommendation_fields
BEFORE INSERT OR UPDATE OF category, caption, hashtags, ocr_text, vision_caption, vision_labels, analysis_text
ON posts
FOR EACH ROW
EXECUTE FUNCTION sync_post_recommendation_fields();

DROP TRIGGER IF EXISTS trg_comments_sync_search_fields ON comments;
CREATE TRIGGER trg_comments_sync_search_fields
BEFORE INSERT OR UPDATE OF text
ON comments
FOR EACH ROW
EXECUTE FUNCTION sync_comment_search_fields();

DROP TRIGGER IF EXISTS trg_user_searches_sync_fields ON user_searches;
CREATE TRIGGER trg_user_searches_sync_fields
BEFORE INSERT OR UPDATE OF query_text, matched_category, matched_hashtags
ON user_searches
FOR EACH ROW
EXECUTE FUNCTION sync_user_search_fields();

UPDATE posts
SET content_text = trim(
        BOTH ' '
        FROM COALESCE(category::TEXT, '')
        || ' '
        || COALESCE(caption, '')
        || ' '
        || COALESCE(ocr_text, '')
        || ' '
        || COALESCE(vision_caption, '')
        || ' '
        || array_to_string(COALESCE(vision_labels, ARRAY[]::TEXT[]), ' ')
        || ' '
        || COALESCE(analysis_text, '')
        || ' '
        || array_to_string(COALESCE(hashtags, ARRAY[]::TEXT[]), ' ')
    ),
    content_tsv = to_tsvector(
        'english',
        trim(
            BOTH ' '
            FROM COALESCE(category::TEXT, '')
            || ' '
            || COALESCE(caption, '')
            || ' '
            || COALESCE(ocr_text, '')
            || ' '
            || COALESCE(vision_caption, '')
            || ' '
            || array_to_string(COALESCE(vision_labels, ARRAY[]::TEXT[]), ' ')
            || ' '
            || COALESCE(analysis_text, '')
            || ' '
            || array_to_string(COALESCE(hashtags, ARRAY[]::TEXT[]), ' ')
        )
    );

UPDATE comments
SET text_tsv = to_tsvector('english', COALESCE(text, ''));

UPDATE user_searches
SET normalized_query = lower(trim(regexp_replace(COALESCE(query_text, ''), '\s+', ' ', 'g'))),
    query_tsv = to_tsvector(
        'english',
        trim(
            BOTH ' '
            FROM COALESCE(query_text, '')
            || ' '
            || COALESCE(matched_category::TEXT, '')
            || ' '
            || array_to_string(COALESCE(matched_hashtags, ARRAY[]::TEXT[]), ' ')
        )
    );

CREATE OR REPLACE VIEW recommendation_training_rows AS
SELECT
    p.id AS post_id,
    p.user_id AS author_id,
    p.category::TEXT AS category,
    p.caption,
    p.hashtags,
    p.content_text,
    p.content_tsv,
    p.embedding,
    p.created_at,
    COALESCE(p.share_count, 0) AS share_count,
    COALESCE(l.like_count, 0) AS like_count,
    COALESCE(c.comment_count, 0) AS comment_count,
    COALESCE(s.save_count, 0) AS save_count
FROM posts p
LEFT JOIN (
    SELECT post_id, COUNT(*) AS like_count
    FROM likes
    GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comment_count
    FROM comments
    GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS save_count
    FROM saved_posts
    GROUP BY post_id
) s ON s.post_id = p.id;

CREATE OR REPLACE VIEW user_interest_events AS
SELECT
    l.user_id,
    'like'::TEXT AS event_type,
    3.0::DOUBLE PRECISION AS event_weight,
    l.post_id,
    p.category::TEXT AS category,
    p.hashtags,
    p.content_text,
    p.content_tsv,
    l.created_at AS occurred_at
FROM likes l
JOIN posts p ON p.id = l.post_id
UNION ALL
SELECT
    sp.user_id,
    'save'::TEXT AS event_type,
    4.0::DOUBLE PRECISION AS event_weight,
    sp.post_id,
    p.category::TEXT AS category,
    p.hashtags,
    p.content_text,
    p.content_tsv,
    sp.created_at AS occurred_at
FROM saved_posts sp
JOIN posts p ON p.id = sp.post_id
UNION ALL
SELECT
    c.user_id,
    'comment'::TEXT AS event_type,
    5.0::DOUBLE PRECISION AS event_weight,
    c.post_id,
    p.category::TEXT AS category,
    p.hashtags,
    p.content_text,
    p.content_tsv,
    c.created_at AS occurred_at
FROM comments c
JOIN posts p ON p.id = c.post_id
UNION ALL
SELECT
    us.user_id,
    'search'::TEXT AS event_type,
    2.0::DOUBLE PRECISION AS event_weight,
    us.clicked_post_id AS post_id,
    us.matched_category::TEXT AS category,
    us.matched_hashtags AS hashtags,
    trim(
        BOTH ' '
        FROM COALESCE(us.query_text, '')
        || ' '
        || COALESCE(us.matched_category::TEXT, '')
        || ' '
        || array_to_string(COALESCE(us.matched_hashtags, ARRAY[]::TEXT[]), ' ')
    ) AS content_text,
    us.query_tsv AS content_tsv,
    us.created_at AS occurred_at
FROM user_searches us;

CREATE OR REPLACE VIEW post_hashtag_tokens AS
SELECT
    p.id AS post_id,
    unnest(p.hashtags) AS hashtag
FROM posts p;
