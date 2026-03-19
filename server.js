const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const pool = require('./db');
const { uploadBufferToCloudinary } = require('./cloudinary');
const { generateEmbedding } = require('./embeddings');
const { analyzePostIntelligence } = require('./post_intelligence');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
    },
    fileFilter: (req, file, cb) => {
        if (!String(file.mimetype || '').startsWith('image/')) {
            cb(new Error('Only image uploads are supported'));
            return;
        }
        cb(null, true);
    },
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) return res.sendStatus(403);
        try {
            const result = await pool.query(
                'SELECT id, username, profile_pic FROM users WHERE id = $1',
                [user.id]
            );
            if (result.rows.length === 0) {
                return res.status(401).json({ error: 'Session expired. Please log in again.' });
            }
            req.user = {
                id: result.rows[0].id,
                username: result.rows[0].username,
                profile_pic: result.rows[0].profile_pic,
            };
            next();
        } catch (dbErr) {
            res.status(500).json({ error: dbErr.message });
        }
    });
};

function parseLimit(value, fallback = 30, max = 90) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function parseOffset(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) return fallback;
    return parsed;
}

function getFeedSeed(value) {
    return String(value || Date.now());
}

function normalizeRecommendationText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildPostEmbeddingText(post) {
    return normalizeRecommendationText([
        post.analysis_text,
        post.content_text,
        post.category,
        post.caption,
        Array.isArray(post.hashtags) ? post.hashtags.join(' ') : '',
    ].filter(Boolean).join(' '));
}

function weightedAverageVectors(weightedVectors) {
    const validVectors = weightedVectors.filter(({ vector, weight }) =>
        Array.isArray(vector)
        && vector.length > 0
        && Number.isFinite(Number(weight))
        && Number(weight) > 0
    );

    if (validVectors.length === 0) {
        return null;
    }

    const dimensions = validVectors[0].vector.length;
    const sum = new Array(dimensions).fill(0);
    let totalWeight = 0;

    for (const { vector, weight } of validVectors) {
        if (vector.length !== dimensions) {
            continue;
        }

        const safeWeight = Number(weight);
        totalWeight += safeWeight;
        for (let index = 0; index < dimensions; index += 1) {
            sum[index] += vector[index] * safeWeight;
        }
    }

    if (!totalWeight) {
        return null;
    }

    return sum.map((value) => Number((value / totalWeight).toFixed(6)));
}

async function ensurePostEmbedding(postId) {
    const result = await pool.query(
        `SELECT id, embedding, analysis_text, content_text, category, caption, hashtags
         FROM posts
         WHERE id = $1`,
        [postId]
    );
    const post = result.rows[0];

    if (!post) {
        return null;
    }

    if (Array.isArray(post.embedding) && post.embedding.length > 0) {
        return post.embedding;
    }

    const embeddingText = buildPostEmbeddingText(post);
    if (!embeddingText) {
        return null;
    }

    const embedding = await generateEmbedding(embeddingText);
    if (!embedding) {
        return null;
    }

    await pool.query('UPDATE posts SET embedding = $1 WHERE id = $2', [embedding, postId]);
    return embedding;
}

async function getUserRecommendationProfile(userId) {
    const result = await pool.query(`
        SELECT
            interest_embedding,
            EXISTS(
                SELECT 1
                FROM follows
                WHERE follower_id = $1 AND status = 'accepted'
            ) AS has_follows,
            (
                EXISTS(SELECT 1 FROM likes WHERE user_id = $1)
                OR EXISTS(SELECT 1 FROM saved_posts WHERE user_id = $1)
                OR EXISTS(SELECT 1 FROM comments WHERE user_id = $1)
                OR EXISTS(SELECT 1 FROM post_interest_feedback WHERE user_id = $1)
            ) AS has_signals
        FROM users
        WHERE id = $1
    `, [userId]);

    return result.rows[0] || { interest_embedding: null, has_follows: false, has_signals: false };
}

async function refreshUserInterestEmbedding(userId) {
    const signalPosts = await pool.query(
        `
        SELECT
            p.id,
            p.embedding,
            p.analysis_text,
            p.content_text,
            p.category,
            p.caption,
            p.hashtags,
            signals.signal_weight
        FROM (
            SELECT post_id, 2.5::DOUBLE PRECISION AS signal_weight
            FROM likes
            WHERE user_id = $1
            UNION ALL
            SELECT post_id, 3.25::DOUBLE PRECISION AS signal_weight
            FROM saved_posts
            WHERE user_id = $1
            UNION ALL
            SELECT post_id, 3.75::DOUBLE PRECISION AS signal_weight
            FROM comments
            WHERE user_id = $1
            UNION ALL
            SELECT
                post_id,
                CASE
                    WHEN feedback = 'interested' THEN 4.5::DOUBLE PRECISION
                    ELSE 0::DOUBLE PRECISION
                END AS signal_weight
            FROM post_interest_feedback
            WHERE user_id = $1
        ) signals
        JOIN posts p ON p.id = signals.post_id
        WHERE signals.signal_weight > 0
        `,
        [userId]
    );

    if (signalPosts.rows.length === 0) {
        await pool.query('UPDATE users SET interest_embedding = NULL WHERE id = $1', [userId]);
        return;
    }

    const weightedVectors = [];

    for (const row of signalPosts.rows) {
        let embedding = Array.isArray(row.embedding) && row.embedding.length > 0
            ? row.embedding
            : await ensurePostEmbedding(row.id);

        if (!embedding) {
            const fallbackEmbeddingText = buildPostEmbeddingText(row);
            embedding = fallbackEmbeddingText ? await generateEmbedding(fallbackEmbeddingText) : null;
        }

        if (embedding) {
            weightedVectors.push({
                vector: embedding,
                weight: Number(row.signal_weight || 1),
            });
        }
    }

    const avgVec = weightedAverageVectors(weightedVectors);
    if (avgVec) {
        await pool.query('UPDATE users SET interest_embedding = $1 WHERE id = $2', [avgVec, userId]);
        return;
    }

    await pool.query('UPDATE users SET interest_embedding = NULL WHERE id = $1', [userId]);
}

function queueInterestEmbeddingRefresh(userId) {
    refreshUserInterestEmbedding(userId)
        .then(() => console.log(`Interest embedding refreshed for user ${userId}`))
        .catch(err => console.error('Interest embedding update error:', err.message));
}

const STORY_EXPIRY_INTERVAL = "24 HOURS";
const STORY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

async function cleanupExpiredStories() {
    const result = await pool.query(
        `DELETE FROM stories
         WHERE created_at < NOW() - INTERVAL '${STORY_EXPIRY_INTERVAL}'`
    );
    return result.rowCount || 0;
}

async function getVisibleStoryForUser(storyId, userId) {
    const result = await pool.query(
        `
        SELECT
            s.id,
            s.image_url,
            s.created_at,
            s.user_id,
            u.username,
            u.profile_pic,
            (SELECT COUNT(*) FROM story_likes WHERE story_id = s.id) AS like_count,
            (SELECT COUNT(*) FROM story_comments WHERE story_id = s.id) AS comment_count,
            EXISTS(SELECT 1 FROM story_likes WHERE story_id = s.id AND user_id = $2) AS is_liked
        FROM stories s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = $1
          AND s.created_at >= NOW() - INTERVAL '${STORY_EXPIRY_INTERVAL}'
          AND (
              s.user_id = $2
              OR u.is_private = false
              OR s.user_id IN (
                  SELECT following_id
                  FROM follows
                  WHERE follower_id = $2 AND status = 'accepted'
              )
          )
        `,
        [storyId, userId]
    );

    return result.rows[0] || null;
}

async function getStoryInteractions(storyId, userId) {
    const story = await getVisibleStoryForUser(storyId, userId);
    if (!story) {
        return null;
    }

    const commentsResult = await pool.query(
        `
        SELECT sc.id, sc.story_id, sc.text, sc.created_at, sc.updated_at, sc.user_id, u.username, u.profile_pic
        FROM story_comments sc
        JOIN users u ON u.id = sc.user_id
        WHERE sc.story_id = $1
        ORDER BY sc.created_at ASC
        `,
        [storyId]
    );

    return {
        ...story,
        like_count: Number(story.like_count || 0),
        comment_count: Number(story.comment_count || 0),
        is_liked: Boolean(story.is_liked),
        comments: commentsResult.rows,
    };
}

async function uploadImageAsset(file, folder) {
    const result = await uploadBufferToCloudinary(file, { folder, resourceType: 'image' });
    return {
        secureUrl: result.secure_url,
        source: {
            url: result.secure_url,
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalName: file.originalname,
            label: result.secure_url,
        },
    };
}

async function getPostImageSources(postId) {
    const result = await pool.query(
        'SELECT image_url FROM post_images WHERE post_id = $1 ORDER BY sort_order ASC, id ASC',
        [postId]
    );
    return result.rows
        .map((row) => row.image_url)
        .filter(Boolean);
}

async function queuePostIntelligenceAnalysis(postId, caption, imageSources) {
    try {
        await pool.query(
            `UPDATE posts
             SET analysis_status = 'processing',
                 analysis_updated_at = NOW(),
                 metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('analysis_status', 'processing')
             WHERE id = $1`,
            [postId]
        );

        const analysis = await analyzePostIntelligence({ caption, imageSources });
        await pool.query(
            `UPDATE posts
             SET category = COALESCE($2::post_category, category),
                 hashtags = CASE
                     WHEN COALESCE(array_length($3::TEXT[], 1), 0) > 0 THEN $3::TEXT[]
                     ELSE hashtags
                 END,
                 embedding = COALESCE($4::DOUBLE PRECISION[], embedding),
                 ocr_text = COALESCE($5, ''),
                 vision_caption = COALESCE($6, ''),
                 vision_labels = COALESCE($7::TEXT[], ARRAY[]::TEXT[]),
                 analysis_text = COALESCE($8, ''),
                 analysis_status = $9,
                 analysis_updated_at = NOW(),
                 metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb
             WHERE id = $1`,
            [
                postId,
                analysis.category,
                analysis.hashtags,
                analysis.embedding,
                analysis.ocrText,
                analysis.visionCaption,
                analysis.visionLabels,
                analysis.analysisText,
                analysis.analysisStatus,
                JSON.stringify(analysis.metadata),
            ]
        );
        console.log(`Post intelligence updated for post ${postId}`);
    } catch (error) {
        console.error(`Post intelligence failed for post ${postId}:`, error.message);
        await pool.query(
            `UPDATE posts
             SET analysis_status = 'failed',
                 analysis_updated_at = NOW(),
                 metadata = COALESCE(metadata, '{}'::jsonb)
                     || jsonb_build_object('analysis_status', 'failed', 'analysis_error', $2)
             WHERE id = $1`,
            [postId, String(error.message || 'unknown error').slice(0, 200)]
        ).catch((metadataError) => {
            console.error(`Failed to store analysis error for post ${postId}:`, metadataError.message);
        });
    }
}

async function fetchDiscoveryPosts(userId, limit, offset, seed) {
    const query = `
        SELECT
            p.id,
            p.caption,
            p.category,
            p.created_at,
            p.user_id,
            u.username,
            u.profile_pic,
            COALESCE(JSON_AGG(pi.image_url ORDER BY pi.sort_order) FILTER (WHERE pi.image_url IS NOT NULL), '[]') AS images,
            (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
            EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
            EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) AS is_saved,
            COALESCE(pf.feedback, 'none') AS interest_feedback
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN post_images pi ON p.id = pi.post_id
        LEFT JOIN post_interest_feedback pf ON pf.post_id = p.id AND pf.user_id = $1
        WHERE p.user_id <> $1
          AND (
              u.is_private = false
              OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1 AND status = 'accepted')
          )
          AND COALESCE(pf.feedback, 'none') <> 'not_interested'
        GROUP BY p.id, u.id, pf.feedback
        ORDER BY md5(p.id::text || ':' || $2::text) ASC, p.created_at DESC
        LIMIT $3 OFFSET $4
    `;
    const result = await pool.query(query, [userId, seed, limit, offset]);
    return result.rows;
}

async function fetchPersonalizedPosts(userId, limit, offset, seed, userEmbedding, surface) {
    const followBoost = surface === 'feed' ? 14 : 0;
    const categoryWeight = surface === 'feed' ? 6.5 : 7.5;
    const embeddingWeight = surface === 'feed' ? 16 : 18;
    const query = `
        WITH followings AS (
            SELECT following_id
            FROM follows
            WHERE follower_id = $1 AND status = 'accepted'
        ),
        category_preferences AS (
            SELECT category, SUM(weight) AS preference_score
            FROM (
                SELECT p.category, 2.5::DOUBLE PRECISION AS weight
                FROM likes l
                JOIN posts p ON p.id = l.post_id
                WHERE l.user_id = $1
                UNION ALL
                SELECT p.category, 3.5::DOUBLE PRECISION AS weight
                FROM saved_posts sp
                JOIN posts p ON p.id = sp.post_id
                WHERE sp.user_id = $1
                UNION ALL
                SELECT p.category, 4.5::DOUBLE PRECISION AS weight
                FROM comments c
                JOIN posts p ON p.id = c.post_id
                WHERE c.user_id = $1
                UNION ALL
                SELECT p.category,
                    CASE
                        WHEN pf.feedback = 'interested' THEN 7.5::DOUBLE PRECISION
                        ELSE -9.5::DOUBLE PRECISION
                    END AS weight
                FROM post_interest_feedback pf
                JOIN posts p ON p.id = pf.post_id
                WHERE pf.user_id = $1
            ) preference_events
            WHERE category IS NOT NULL
            GROUP BY category
        ),
        visible_posts AS (
            SELECT
                p.id,
                p.caption,
                p.category,
                p.created_at,
                p.user_id,
                u.username,
                u.profile_pic,
                COALESCE(JSON_AGG(pi.image_url ORDER BY pi.sort_order) FILTER (WHERE pi.image_url IS NOT NULL), '[]') AS images,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
                EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) AS is_saved,
                COALESCE(cp.preference_score, 0) AS category_score,
                COALESCE(pf.feedback, 'none') AS interest_feedback,
                CASE
                    WHEN p.user_id IN (SELECT following_id FROM followings) THEN ${followBoost}
                    ELSE 0
                END AS social_score,
                CASE
                    WHEN $2::DOUBLE PRECISION[] IS NOT NULL AND p.embedding IS NOT NULL
                        THEN cosine_similarity(p.embedding, $2::DOUBLE PRECISION[])
                    ELSE 0
                END AS embedding_score,
                md5(p.id::text || ':' || $3::text) AS rotation_key
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_images pi ON p.id = pi.post_id
            LEFT JOIN category_preferences cp ON cp.category = p.category
            LEFT JOIN post_interest_feedback pf ON pf.post_id = p.id AND pf.user_id = $1
            WHERE p.user_id <> $1
              AND (
                  u.is_private = false
                  OR p.user_id IN (SELECT following_id FROM followings)
              )
            GROUP BY p.id, u.id, cp.preference_score, pf.feedback
        )
        SELECT
            id,
            caption,
            category,
            created_at,
            user_id,
            username,
            profile_pic,
            images,
            like_count,
            comment_count,
            is_liked,
            is_saved,
            interest_feedback,
            recommendation_score
        FROM (
            SELECT
                *,
                CASE
                    WHEN interest_feedback = 'not_interested' THEN -9999
                    ELSE social_score
                        + (category_score * ${categoryWeight})
                        + (CASE WHEN interest_feedback = 'interested' THEN 24 ELSE 0 END)
                        + (embedding_score * ${embeddingWeight})
                END AS recommendation_score
            FROM visible_posts
        ) ranked
        WHERE interest_feedback <> 'not_interested'
        ORDER BY
            recommendation_score DESC,
            created_at DESC,
            rotation_key ASC
        LIMIT $4 OFFSET $5
    `;
    const result = await pool.query(query, [userId, userEmbedding, seed, limit, offset]);
    return result.rows;
}

async function fetchRecommendationCandidates(userId, seed, userEmbedding, maxCandidates = 360) {
    const query = `
        WITH followings AS (
            SELECT following_id
            FROM follows
            WHERE follower_id = $1 AND status = 'accepted'
        ),
        category_preferences AS (
            SELECT category, SUM(weight) AS preference_score
            FROM (
                SELECT p.category, 1.0::DOUBLE PRECISION AS weight
                FROM likes l
                JOIN posts p ON p.id = l.post_id
                WHERE l.user_id = $1
                UNION ALL
                SELECT p.category, 1.2::DOUBLE PRECISION AS weight
                FROM saved_posts sp
                JOIN posts p ON p.id = sp.post_id
                WHERE sp.user_id = $1
                UNION ALL
                SELECT p.category, 1.4::DOUBLE PRECISION AS weight
                FROM comments c
                JOIN posts p ON p.id = c.post_id
                WHERE c.user_id = $1
                UNION ALL
                SELECT p.category,
                    CASE
                        WHEN pf.feedback = 'interested' THEN 2.4::DOUBLE PRECISION
                        ELSE -2.1::DOUBLE PRECISION
                    END AS weight
                FROM post_interest_feedback pf
                JOIN posts p ON p.id = pf.post_id
                WHERE pf.user_id = $1
            ) preference_events
            WHERE category IS NOT NULL
            GROUP BY category
        )
        SELECT
            p.id,
            p.caption,
            p.category,
            p.created_at,
            p.user_id,
            u.username,
            u.profile_pic,
            COALESCE(JSON_AGG(pi.image_url ORDER BY pi.sort_order) FILTER (WHERE pi.image_url IS NOT NULL), '[]') AS images,
            (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
            EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
            EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) AS is_saved,
            COALESCE(cp.preference_score, 0) AS category_score,
            COALESCE(pf.feedback, 'none') AS interest_feedback,
            CASE WHEN p.user_id IN (SELECT following_id FROM followings) THEN TRUE ELSE FALSE END AS is_followed_author,
            CASE
                WHEN $2::DOUBLE PRECISION[] IS NOT NULL AND p.embedding IS NOT NULL
                    THEN cosine_similarity(p.embedding, $2::DOUBLE PRECISION[])
                ELSE 0
            END AS embedding_score,
            md5(p.id::text || ':' || $3::text) AS rotation_key
        FROM posts p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN post_images pi ON p.id = pi.post_id
        LEFT JOIN category_preferences cp ON cp.category = p.category
        LEFT JOIN post_interest_feedback pf ON pf.post_id = p.id AND pf.user_id = $1
        WHERE p.user_id <> $1
          AND (
              u.is_private = false
              OR p.user_id IN (SELECT following_id FROM followings)
          )
          AND COALESCE(pf.feedback, 'none') <> 'not_interested'
        GROUP BY p.id, u.id, cp.preference_score, pf.feedback
        ORDER BY p.created_at DESC, rotation_key ASC
        LIMIT $4
    `;

    const result = await pool.query(query, [userId, userEmbedding, seed, maxCandidates]);
    return result.rows.map((row) => ({
        ...row,
        like_count: Number(row.like_count || 0),
        comment_count: Number(row.comment_count || 0),
        category_score: Number(row.category_score || 0),
        embedding_score: Number(row.embedding_score || 0),
    }));
}

function getRotationScore(rotationKey) {
    if (!rotationKey) return 0.5;
    return parseInt(rotationKey.slice(0, 8), 16) / 0xffffffff;
}

function getRecencyScore(createdAt) {
    const ageHours = Math.max(1, (Date.now() - new Date(createdAt).getTime()) / 3600000);
    return 1 / Math.sqrt((ageHours / 10) + 1);
}

function getPopularityScore(post) {
    return Math.log1p((post.like_count || 0) + ((post.comment_count || 0) * 2));
}

function decorateRecommendationCandidates(candidates) {
    return candidates.map((post) => {
        const rotationScore = getRotationScore(post.rotation_key);
        const recencyScore = getRecencyScore(post.created_at);
        const popularityScore = getPopularityScore(post);
        const categoryAffinity = Math.max(-2.5, Math.min(3.5, post.category_score || 0));
        const embeddingAffinity = Math.max(0, Math.min(1, post.embedding_score || 0));
        const interestedBoost = post.interest_feedback === 'interested' ? 1 : 0;
        const negativeAffinity = Math.max(0, -categoryAffinity);

        return {
            ...post,
            _rotationScore: rotationScore,
            _recencyScore: recencyScore,
            _popularityScore: popularityScore,
            _categoryAffinity: categoryAffinity,
            _embeddingAffinity: embeddingAffinity,
            _interestedBoost: interestedBoost,
            _negativeAffinity: negativeAffinity,
            _preferredScore: (interestedBoost * 3.2)
                + (Math.max(0, categoryAffinity) * 1.6)
                + (embeddingAffinity * 2.8)
                + (recencyScore * 0.8)
                + (popularityScore * 0.25)
                + (rotationScore * 0.15),
            _socialScore: (post.is_followed_author ? 2.4 : 0)
                + (recencyScore * 1.1)
                + (popularityScore * 0.35)
                + (Math.max(0, categoryAffinity) * 0.4)
                + (rotationScore * 0.12),
            _discoveryScore: (recencyScore * 0.95)
                + (popularityScore * 0.55)
                + (rotationScore * 0.75)
                + (Math.max(0, categoryAffinity) * 0.08)
                - (negativeAffinity * 0.45),
            _trendingScore: (popularityScore * 0.85)
                + (recencyScore * 0.7)
                + (rotationScore * 0.25)
                + (Math.max(0, categoryAffinity) * 0.06)
                - (negativeAffinity * 0.4),
        };
    });
}

function sortByScore(list, scoreKey) {
    return [...list].sort((a, b) => {
        if (b[scoreKey] !== a[scoreKey]) return b[scoreKey] - a[scoreKey];
        if (b._recencyScore !== a._recencyScore) return b._recencyScore - a._recencyScore;
        return a.rotation_key.localeCompare(b.rotation_key);
    });
}

function chooseRotatedBucketCandidate(window, slotIndex, surface, bucketName) {
    if (window.length === 0) return null;
    if (window.length === 1) return window[0];

    const sortedWindow = [...window].sort((a, b) => {
        if (a._rotationScore !== b._rotationScore) return a._rotationScore - b._rotationScore;
        if (b._recencyScore !== a._recencyScore) return b._recencyScore - a._recencyScore;
        return a.rotation_key.localeCompare(b.rotation_key);
    });
    const bucketBias = {
        preferred: 0.13,
        social: 0.27,
        discovery: 0.41,
        trending: 0.59,
    }[bucketName] || 0.19;
    const surfaceBias = surface === 'feed' ? 0.17 : 0.33;
    const target = (surfaceBias + bucketBias + (slotIndex * 0.173)) % 1;
    const pickedIndex = Math.min(sortedWindow.length - 1, Math.floor(target * sortedWindow.length));
    return sortedWindow[pickedIndex];
}

function buildRecommendationPage(candidates, { limit, offset, surface, hasSignals, hasFollows }) {
    const decorated = decorateRecommendationCandidates(candidates);
    const preferred = sortByScore(
        decorated.filter(post =>
            post._interestedBoost > 0
            || post._categoryAffinity >= 0.8
            || post._embeddingAffinity >= 0.2
        ),
        '_preferredScore'
    );
    const social = sortByScore(
        decorated.filter(post => post.is_followed_author),
        '_socialScore'
    );
    const discovery = sortByScore(decorated, '_discoveryScore');
    const trending = sortByScore(decorated, '_trendingScore');

    const strictCategoryCap = Math.max(2, Math.ceil(limit * (surface === 'feed' ? 0.28 : 0.25)));
    const relaxedCategoryCap = Math.max(strictCategoryCap + 1, Math.ceil(limit * 0.4));
    const strictAuthorCap = 2;
    const relaxedAuthorCap = 3;
    const firstScreenSlots = Math.min(offset + limit, surface === 'feed' ? 12 : 15);
    const bucketWindowSize = surface === 'feed' ? 8 : 12;
    const targetCount = offset + limit;
    const pattern = hasSignals
        ? (surface === 'feed'
            ? ['social', 'discovery', 'preferred', 'discovery', 'trending', 'discovery', 'preferred', 'discovery']
            : ['preferred', 'discovery', 'trending', 'discovery', 'preferred', 'discovery', 'trending', 'discovery'])
        : ['discovery', 'trending', 'discovery', ...(hasFollows ? ['social'] : []), 'discovery', 'trending'];
    const buckets = { preferred, social, discovery, trending };
    const seen = new Set();
    const categoryCounts = new Map();
    const authorCounts = new Map();
    const result = [];

    const canUsePost = (post, strictMode) => {
        const count = categoryCounts.get(post.category) || 0;
        const authorCount = authorCounts.get(post.user_id) || 0;
        const previousPost = result[result.length - 1];
        const recentCategories = result.slice(-2).map(item => item.category);
        const recentAuthors = result.slice(-3).map(item => item.user_id);
        const categoryCap = strictMode ? strictCategoryCap : relaxedCategoryCap;
        const authorCap = strictMode ? strictAuthorCap : relaxedAuthorCap;

        if (count >= categoryCap) return false;
        if (authorCount >= authorCap) return false;
        if (previousPost && previousPost.user_id === post.user_id) return false;
        if (recentCategories.length === 2 && recentCategories.every(category => category === post.category)) {
            return false;
        }
        if (strictMode && result.length < firstScreenSlots) {
            if (count >= 2) return false;
            if (authorCount >= 1) return false;
            if (recentAuthors.includes(post.user_id)) return false;
        }
        return true;
    };

    const takeFromBucket = (bucketName, strictMode) => {
        const bucket = buckets[bucketName] || [];
        const window = [];

        for (const post of bucket) {
            if (seen.has(post.id)) continue;
            if (!canUsePost(post, strictMode)) continue;
            window.push(post);
            if (window.length >= bucketWindowSize) {
                break;
            }
        }

        return chooseRotatedBucketCandidate(window, result.length, surface, bucketName);
    };

    const bucketOrder = ['preferred', 'social', 'discovery', 'trending'];
    const takeAny = (strictMode) => {
        for (const bucketName of bucketOrder) {
            const post = takeFromBucket(bucketName, strictMode);
            if (post) return post;
        }
        return null;
    };

    let guard = 0;
    while (result.length < targetCount && guard < targetCount * 20) {
        guard += 1;
        const bucketName = pattern[result.length % pattern.length];
        let nextPost = takeFromBucket(bucketName, true);
        if (!nextPost) nextPost = takeAny(true);
        if (!nextPost) nextPost = takeFromBucket(bucketName, false);
        if (!nextPost) nextPost = takeAny(false);
        if (!nextPost) break;

        seen.add(nextPost.id);
        categoryCounts.set(nextPost.category, (categoryCounts.get(nextPost.category) || 0) + 1);
        authorCounts.set(nextPost.user_id, (authorCounts.get(nextPost.user_id) || 0) + 1);
        result.push(nextPost);
    }

    return result.slice(offset, offset + limit).map(({ rotation_key, ...post }) => post);
}

// ==================== SOCKET.IO ====================
const onlineUsers = new Map(); // userId -> Set of socketIds

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return next(new Error('Authentication error'));
        socket.userId = user.id;
        socket.username = user.username;
        next();
    });
});

function emitToUser(userId, event, data) {
    const sockets = onlineUsers.get(parseInt(userId));
    if (sockets) {
        sockets.forEach(sid => io.to(sid).emit(event, data));
    }
}

function emitNotificationRefresh(userIds) {
    [...new Set((userIds || []).map((userId) => parseInt(userId, 10)).filter(Boolean))]
        .forEach((userId) => emitToUser(userId, 'notification_update', {}));
}

const ACTIVITY_NOTIFICATION_UNION = `
    SELECT
        'follow'::TEXT AS type,
        COALESCE(f.accepted_at, f.created_at) AS event_at,
        f.follower_id AS actor_id,
        u.username AS actor_username,
        u.profile_pic AS actor_profile_pic,
        NULL::BIGINT AS post_id,
        NULL::BIGINT AS comment_id,
        NULL::TEXT AS preview_text,
        NULL::TEXT AS context_text
    FROM follows f
    JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = $1
      AND f.status = 'accepted'
      AND f.follower_id <> $1

    UNION ALL

    SELECT
        'post_comment'::TEXT AS type,
        c.created_at AS event_at,
        c.user_id AS actor_id,
        u.username AS actor_username,
        u.profile_pic AS actor_profile_pic,
        p.id AS post_id,
        c.id AS comment_id,
        c.text AS preview_text,
        p.caption AS context_text
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    JOIN users u ON u.id = c.user_id
    LEFT JOIN comments parent ON parent.id = c.parent_comment_id
    WHERE p.user_id = $1
      AND c.user_id <> $1
      AND (c.parent_comment_id IS NULL OR COALESCE(parent.user_id, 0) <> $1)

    UNION ALL

    SELECT
        'comment_reply'::TEXT AS type,
        c.created_at AS event_at,
        c.user_id AS actor_id,
        u.username AS actor_username,
        u.profile_pic AS actor_profile_pic,
        p.id AS post_id,
        c.id AS comment_id,
        c.text AS preview_text,
        parent.text AS context_text
    FROM comments c
    JOIN comments parent ON parent.id = c.parent_comment_id
    JOIN posts p ON p.id = c.post_id
    JOIN users u ON u.id = c.user_id
    WHERE parent.user_id = $1
      AND c.user_id <> $1

    UNION ALL

    SELECT
        'comment_like'::TEXT AS type,
        cl.created_at AS event_at,
        cl.user_id AS actor_id,
        u.username AS actor_username,
        u.profile_pic AS actor_profile_pic,
        p.id AS post_id,
        c.id AS comment_id,
        c.text AS preview_text,
        p.caption AS context_text
    FROM comment_likes cl
    JOIN comments c ON c.id = cl.comment_id
    JOIN posts p ON p.id = c.post_id
    JOIN users u ON u.id = cl.user_id
    WHERE c.user_id = $1
      AND cl.user_id <> $1
`;

async function getPendingFollowRequests(userId) {
    const query = `
        SELECT f.follower_id, u.username, u.profile_pic, f.created_at
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = $1 AND f.status = 'pending'
        ORDER BY f.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
}

async function getActivityNotifications(userId, limit = 40) {
    const query = `
        WITH seen AS (
            SELECT notifications_seen_at
            FROM users
            WHERE id = $1
        )
        SELECT
            activity.*,
            activity.event_at > COALESCE((SELECT notifications_seen_at FROM seen), TO_TIMESTAMP(0)) AS is_unread
        FROM (${ACTIVITY_NOTIFICATION_UNION}) AS activity
        ORDER BY activity.event_at DESC
        LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);
    return result.rows;
}

async function countUnreadActivityNotifications(userId) {
    const query = `
        WITH seen AS (
            SELECT notifications_seen_at
            FROM users
            WHERE id = $1
        )
        SELECT COUNT(*) AS count
        FROM (${ACTIVITY_NOTIFICATION_UNION}) AS activity
        WHERE activity.event_at > COALESCE((SELECT notifications_seen_at FROM seen), TO_TIMESTAMP(0))
    `;
    const result = await pool.query(query, [userId]);
    return parseInt(result.rows[0]?.count || 0, 10);
}

io.on('connection', (socket) => {
    const uid = parseInt(socket.userId);
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);
    io.emit('user_online', { userId: uid });

    socket.on('join_chat', (conversationId) => {
        socket.join(`chat_${conversationId}`);
    });
    socket.on('leave_chat', (conversationId) => {
        socket.leave(`chat_${conversationId}`);
    });
    socket.on('typing', ({ conversationId }) => {
        socket.to(`chat_${conversationId}`).emit('user_typing', { userId: uid, conversationId });
    });
    socket.on('stop_typing', ({ conversationId }) => {
        socket.to(`chat_${conversationId}`).emit('user_stop_typing', { userId: uid, conversationId });
    });    socket.on('disconnect', async () => {
        const set = onlineUsers.get(uid);
        if (set) {
            set.delete(socket.id);
            if (set.size === 0) {
                onlineUsers.delete(uid);
                // Update last_active in database
                try {
                    await pool.query('UPDATE users SET last_active = NOW() WHERE id = $1', [uid]);
                } catch (e) { /* ignore */ }
                const lastActive = new Date().toISOString();
                io.emit('user_offline', { userId: uid, last_active: lastActive });
            }
        }
    });
});

// ==================== AUTH ====================
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username', [username, email, hashedPassword]);
        res.json({ success: true, user: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, identifier, username, password } = req.body;
        const loginIdentifier = String(identifier || email || username || '').trim();
        if (!loginIdentifier || !password) {
            return res.status(400).json({ error: "Identifier and password are required" });
        }
        const result = await pool.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1',
            [loginIdentifier]
        );
        if (result.rows.length === 0) return res.status(400).json({ error: "User not found" });
        const user = result.rows[0];
        if (await bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
            res.json({ success: true, token, user: { id: user.id, username: user.username, profile_pic: user.profile_pic } });
        } else { res.status(403).json({ error: "Wrong password" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== POSTS ====================
app.post('/api/posts', authenticateToken, upload.array('images', 10), async (req, res) => {
    try {
        const { caption } = req.body;
        const postResult = await pool.query('INSERT INTO posts (user_id, caption) VALUES ($1, $2) RETURNING id', [req.user.id, caption]);
        const postId = postResult.rows[0].id;
        let uploadedImageSources = [];
        if (req.files && req.files.length > 0) {
            const uploadedAssets = await Promise.all(
                req.files.map((file) => uploadImageAsset(file, 'instagram-clone/posts'))
            );
            uploadedImageSources = uploadedAssets.map((asset) => asset.source);
            const imageQueries = uploadedAssets.map((uploadedAsset, index) => {
                return pool.query(
                    'INSERT INTO post_images (post_id, image_url, sort_order) VALUES ($1, $2, $3)',
                    [postId, uploadedAsset.secureUrl, index]
                );
            });
            await Promise.all(imageQueries);
        }
        res.json({ success: true, analysis_status: 'processing' });

        queuePostIntelligenceAnalysis(postId, caption, uploadedImageSources)
            .catch((error) => console.error(`Background analysis failed for post ${postId}:`, error.message));
        if (false && caption && caption.trim().length > 0) {
            generateEmbedding(caption).then(embedding => {
                if (embedding) {
                    pool.query('UPDATE posts SET embedding = $1 WHERE id = $2', [embedding, postId])
                        .then(() => console.log(`✅ Embedding stored for post ${postId}`))
                        .catch(err => console.error(`❌ Failed to store embedding for post ${postId}:`, err.message));
                }
            }).catch(err => console.error('Embedding generation error:', err.message));
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/posts', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const limit = parseLimit(req.query.limit, 24, 60);
        const offset = parseOffset(req.query.offset, 0);
        const seed = getFeedSeed(req.query.seed);
        const profile = await getUserRecommendationProfile(currentUserId);
        const candidates = await fetchRecommendationCandidates(currentUserId, seed, profile.interest_embedding);
        const posts = buildRecommendationPage(candidates, {
            limit,
            offset,
            surface: 'feed',
            hasSignals: profile.has_signals,
            hasFollows: profile.has_follows,
        });
        res.json(posts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/posts/:id', authenticateToken, async (req, res) => {
    try {
        const { caption } = req.body;
        const postId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query('SELECT * FROM posts WHERE id = $1 AND user_id = $2', [postId, userId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        await pool.query('UPDATE posts SET caption = $1 WHERE id = $2', [caption, postId]);
        getPostImageSources(postId)
            .then((imageSources) => queuePostIntelligenceAnalysis(postId, caption, imageSources))
            .catch((error) => console.error(`Failed to requeue analysis for post ${postId}:`, error.message));
        res.json({ success: true, caption });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:id/like', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query('SELECT * FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
            res.json({ status: 'unliked' });
        } else {
            await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
            res.json({ status: 'liked' });
        }
        queueInterestEmbeddingRefresh(userId);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query('SELECT * FROM posts WHERE id = $1 AND user_id = $2', [postId, userId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== COMMENTS ====================
app.get('/api/posts/:id/comments', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        const query = `
            SELECT c.id, c.text, c.created_at, c.updated_at, c.user_id, c.is_pinned, c.parent_comment_id, u.username, u.profile_pic,
            (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as like_count,
            EXISTS(SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = $2) as is_liked,
            EXISTS(SELECT 1 FROM comment_likes cl JOIN posts p ON p.id = c.post_id WHERE cl.comment_id = c.id AND cl.user_id = p.user_id) as liked_by_author,
            (SELECT u2.profile_pic FROM users u2 JOIN posts p2 ON p2.user_id = u2.id WHERE p2.id = c.post_id) as author_pic,
            pu.username AS parent_username
            FROM comments c
            JOIN users u ON c.user_id = u.id
            LEFT JOIN comments pc ON pc.id = c.parent_comment_id
            LEFT JOIN users pu ON pu.id = pc.user_id
            WHERE c.post_id = $1
            ORDER BY
                c.is_pinned DESC,
                COALESCE(c.parent_comment_id, c.id) ASC,
                c.parent_comment_id NULLS FIRST,
                c.created_at ASC
        `;
        const result = await pool.query(query, [postId, userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:id/comments', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const { text, parent_comment_id: parentCommentIdRaw } = req.body;
        const userId = req.user.id;
        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Comment text required" });
        }

        const postOwnerResult = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
        if (postOwnerResult.rows.length === 0) {
            return res.status(404).json({ error: "Post not found" });
        }
        const postOwnerId = postOwnerResult.rows[0].user_id;

        let parentCommentId = null;
        let parentUsername = null;
        let parentOwnerId = null;
        if (parentCommentIdRaw) {
            const parentResult = await pool.query(
                'SELECT c.id, c.user_id, u.username FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1 AND c.post_id = $2',
                [parentCommentIdRaw, postId]
            );
            if (parentResult.rows.length === 0) {
                return res.status(400).json({ error: "Reply target not found" });
            }
            parentCommentId = parentResult.rows[0].id;
            parentOwnerId = parentResult.rows[0].user_id;
            parentUsername = parentResult.rows[0].username;
        }

        const result = await pool.query(
            'INSERT INTO comments (post_id, user_id, parent_comment_id, text) VALUES ($1, $2, $3, $4) RETURNING id, created_at, is_pinned, parent_comment_id',
            [postId, userId, parentCommentId, text.trim()]
        );
        const newComment = {
            id: result.rows[0].id,
            text: text.trim(),
            created_at: result.rows[0].created_at,
            user_id: userId,
            username: req.user.username,
            profile_pic: req.user.profile_pic,
            is_pinned: false,
            parent_comment_id: result.rows[0].parent_comment_id,
            parent_username: parentUsername,
            like_count: 0,
            is_liked: false,
            liked_by_author: false,
        };
        res.json({ success: true, comment: newComment });
        queueInterestEmbeddingRefresh(userId);
        emitNotificationRefresh([postOwnerId, parentOwnerId]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/comments/:id/like', authenticateToken, async (req, res) => {
    try {
        const commentId = req.params.id;
        const userId = req.user.id;
        const ownerResult = await pool.query('SELECT user_id FROM comments WHERE id = $1', [commentId]);
        if (ownerResult.rows.length === 0) {
            return res.status(404).json({ error: "Comment not found" });
        }
        const commentOwnerId = ownerResult.rows[0].user_id;
        const check = await pool.query('SELECT * FROM comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
            emitNotificationRefresh([commentOwnerId]);
            res.json({ status: 'unliked' });
        } else {
            await pool.query('INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)', [commentId, userId]);
            emitNotificationRefresh([commentOwnerId]);
            res.json({ status: 'liked' });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/comments/:id', authenticateToken, async (req, res) => {
    try {
        const commentId = req.params.id;
        const userId = req.user.id;
        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: "Comment text required" });
        const check = await pool.query(`SELECT c.id, c.user_id FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = $1 AND (c.user_id = $2 OR p.user_id = $2)`, [commentId, userId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        await pool.query('UPDATE comments SET text = $1 WHERE id = $2', [text.trim(), commentId]);
        res.json({ success: true, text: text.trim() });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/comments/:id/pin', authenticateToken, async (req, res) => {
    try {
        const commentId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query(`SELECT c.id, c.is_pinned FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = $1 AND p.user_id = $2`, [commentId, userId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        const newStatus = !check.rows[0].is_pinned;
        await pool.query('UPDATE comments SET is_pinned = $1 WHERE id = $2', [newStatus, commentId]);
        res.json({ success: true, is_pinned: newStatus });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/comments/:id', authenticateToken, async (req, res) => {
    try {
        const commentId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query(
            `SELECT c.id, c.user_id, p.user_id AS post_owner_id, c.parent_comment_id, parent.user_id AS parent_owner_id
             FROM comments c
             JOIN posts p ON c.post_id = p.id
             LEFT JOIN comments parent ON parent.id = c.parent_comment_id
             WHERE c.id = $1 AND (c.user_id = $2 OR p.user_id = $2)`,
            [commentId, userId]
        );
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
        queueInterestEmbeddingRefresh(check.rows[0].user_id);
        emitNotificationRefresh([check.rows[0].post_owner_id, check.rows[0].parent_owner_id]);
        res.json({ success: true, message: "Comment deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== PROFILE, PRIVACY & REQUESTS ====================
app.get('/api/users/:username', authenticateToken, async (req, res) => {
    try {
        const { username } = req.params;
        const currentUserId = req.user.id;
        const userQuery = `
            SELECT u.id, u.username, u.profile_pic, u.is_private,
            (SELECT COUNT(*) FROM follows WHERE following_id = u.id AND status = 'accepted') as followers_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id = u.id AND status = 'accepted') as following_count,
            (SELECT status FROM follows WHERE follower_id = $1 AND following_id = u.id) as follow_status
            FROM users u WHERE u.username = $2
        `;
        const userRes = await pool.query(userQuery, [currentUserId, username]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const targetUser = userRes.rows[0];
        const isSelf = parseInt(currentUserId) === parseInt(targetUser.id);
        const isFollowing = targetUser.follow_status === 'accepted';
        if (targetUser.is_private && !isFollowing && !isSelf) {
            return res.json({ user: targetUser, posts: [], restricted: true });
        }
        const postsQuery = `
            SELECT p.*,
            COALESCE(JSON_AGG(pi.image_url) FILTER (WHERE pi.image_url IS NOT NULL), '[]') as images,
            u.username, u.profile_pic, 
            (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count, 
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count, 
            EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) as is_liked,
            EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) as is_saved
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            LEFT JOIN post_images pi ON p.id = pi.post_id 
            WHERE p.user_id = $2 
            GROUP BY p.id, u.id
            ORDER BY p.created_at DESC
        `;
        const postsRes = await pool.query(postsQuery, [currentUserId, targetUser.id]);
        res.json({ user: targetUser, posts: postsRes.rows, restricted: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/privacy', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const current = await pool.query('SELECT is_private FROM users WHERE id = $1', [userId]);
        const newStatus = !current.rows[0].is_private;
        await pool.query('UPDATE users SET is_private = $1 WHERE id = $2', [newStatus, userId]);
        res.json({ success: true, is_private: newStatus });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/follow/:id', authenticateToken, async (req, res) => {
    try {
        const targetId = req.params.id;
        const followerId = req.user.id;
        const check = await pool.query('SELECT * FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, targetId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, targetId]);
            emitNotificationRefresh([targetId]);
            res.json({ status: "none" });
        } else {
            const target = await pool.query('SELECT is_private FROM users WHERE id = $1', [targetId]);
            const isPrivate = target.rows[0].is_private;
            const status = isPrivate ? 'pending' : 'accepted';
            await pool.query(
                'INSERT INTO follows (follower_id, following_id, status, accepted_at) VALUES ($1, $2, $3, $4)',
                [followerId, targetId, status, status === 'accepted' ? new Date() : null]
            );
            emitNotificationRefresh([targetId]);
            res.json({ status: status });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/requests', authenticateToken, async (req, res) => {
    try {
        res.json(await getPendingFollowRequests(req.user.id));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/requests/:id/confirm', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query(
            "UPDATE follows SET status = 'accepted', accepted_at = NOW() WHERE follower_id = $1 AND following_id = $2",
            [followerId, userId]
        );
        emitNotificationRefresh([userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/requests/:id/delete', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, userId]);
        emitNotificationRefresh([userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [requests, activities, meResult] = await Promise.all([
            getPendingFollowRequests(userId),
            getActivityNotifications(userId, 60),
            pool.query('SELECT notifications_seen_at FROM users WHERE id = $1', [userId]),
        ]);
        res.json({
            requests,
            activities,
            seen_at: meResult.rows[0]?.notifications_seen_at || null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/read', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE users SET notifications_seen_at = NOW() WHERE id = $1 RETURNING notifications_seen_at',
            [req.user.id]
        );
        emitNotificationRefresh([req.user.id]);
        res.json({ success: true, notifications_seen_at: result.rows[0]?.notifications_seen_at || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/followers/:id', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, profile_pic, is_private FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me/interest-feedback', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const feedback = req.query.feedback;
        if (feedback && !['interested', 'not_interested'].includes(feedback)) {
            return res.status(400).json({ error: 'Invalid feedback filter' });
        }

        const query = `
            SELECT
                p.id,
                p.caption,
                p.category,
                p.created_at,
                p.user_id,
                u.username,
                u.profile_pic,
                COALESCE(JSON_AGG(pi.image_url ORDER BY pi.sort_order) FILTER (WHERE pi.image_url IS NOT NULL), '[]') AS images,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
                EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) AS is_saved,
                pf.feedback AS interest_feedback,
                pf.updated_at AS feedback_updated_at
            FROM post_interest_feedback pf
            JOIN posts p ON p.id = pf.post_id
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_images pi ON p.id = pi.post_id
            WHERE pf.user_id = $1
              AND ($2::TEXT IS NULL OR pf.feedback = $2)
            GROUP BY p.id, u.id, pf.feedback, pf.updated_at
            ORDER BY pf.updated_at DESC
        `;
        const result = await pool.query(query, [userId, feedback || null]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me/interactions/liked', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const query = `
            SELECT
                p.id,
                p.caption,
                p.category,
                p.created_at,
                p.user_id,
                u.username,
                u.profile_pic,
                COALESCE((
                    SELECT JSON_AGG(pi.image_url ORDER BY pi.sort_order)
                    FROM post_images pi
                    WHERE pi.post_id = p.id
                ), '[]'::json) AS images,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
                true AS is_liked,
                EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) AS is_saved,
                COALESCE((
                    SELECT feedback
                    FROM post_interest_feedback
                    WHERE post_id = p.id AND user_id = $1
                ), 'none') AS interest_feedback,
                l.created_at AS liked_at
            FROM likes l
            JOIN posts p ON p.id = l.post_id
            JOIN users u ON u.id = p.user_id
            WHERE l.user_id = $1
              AND (
                  p.user_id = $1
                  OR u.is_private = false
                  OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1 AND status = 'accepted')
              )
            ORDER BY l.created_at DESC
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me/interactions/commented', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const query = `
            SELECT
                p.id,
                p.caption,
                p.category,
                p.created_at,
                p.user_id,
                u.username,
                u.profile_pic,
                COALESCE((
                    SELECT JSON_AGG(pi.image_url ORDER BY pi.sort_order)
                    FROM post_images pi
                    WHERE pi.post_id = p.id
                ), '[]'::json) AS images,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
                EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) AS is_saved,
                COALESCE((
                    SELECT feedback
                    FROM post_interest_feedback
                    WHERE post_id = p.id AND user_id = $1
                ), 'none') AS interest_feedback,
                comment_meta.latest_comment_at,
                comment_meta.my_comment_count,
                comment_meta.my_comments
            FROM posts p
            JOIN users u ON u.id = p.user_id
            JOIN LATERAL (
                SELECT
                    MAX(c.created_at) AS latest_comment_at,
                    COUNT(*)::INT AS my_comment_count,
                    COALESCE(
                        JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'id', c.id,
                                'text', c.text,
                                'created_at', c.created_at,
                                'updated_at', c.updated_at,
                                'parent_comment_id', c.parent_comment_id
                            )
                            ORDER BY c.created_at DESC
                        ),
                        '[]'::json
                    ) AS my_comments
                FROM comments c
                WHERE c.post_id = p.id
                  AND c.user_id = $1
            ) AS comment_meta ON comment_meta.my_comment_count > 0
            WHERE (
                p.user_id = $1
                OR u.is_private = false
                OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1 AND status = 'accepted')
            )
            ORDER BY comment_meta.latest_comment_at DESC
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== STORIES, AVATAR, SEARCH ====================
app.post('/api/stories', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        await cleanupExpiredStories();
        if (!req.file) {
            return res.status(400).json({ error: "Story image required" });
        }
        const uploadedAsset = await uploadImageAsset(req.file, 'instagram-clone/stories');
        await pool.query('INSERT INTO stories (user_id, image_url) VALUES ($1, $2)', [req.user.id, uploadedAsset.secureUrl]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/stories', authenticateToken, async (req, res) => {
    try {
        await cleanupExpiredStories();
        const currentUserId = req.user.id;
        const query = `
            SELECT
                s.id,
                s.image_url,
                s.created_at,
                u.username,
                u.profile_pic,
                s.user_id,
                (SELECT COUNT(*) FROM story_likes WHERE story_id = s.id) AS like_count,
                (SELECT COUNT(*) FROM story_comments WHERE story_id = s.id) AS comment_count,
                EXISTS(SELECT 1 FROM story_likes WHERE story_id = s.id AND user_id = $1) AS is_liked
            FROM stories s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.created_at >= NOW() - INTERVAL '${STORY_EXPIRY_INTERVAL}'
              AND (
                  s.user_id = $1
                  OR u.is_private = false
                  OR s.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1 AND status = 'accepted')
              )
            ORDER BY s.created_at DESC
        `;
        const result = await pool.query(query, [currentUserId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/stories/:id/interactions', authenticateToken, async (req, res) => {
    try {
        await cleanupExpiredStories();
        const story = await getStoryInteractions(req.params.id, req.user.id);
        if (!story) {
            return res.status(404).json({ error: "Story not available" });
        }
        res.json(story);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stories/:id/like', authenticateToken, async (req, res) => {
    try {
        await cleanupExpiredStories();
        const storyId = req.params.id;
        const userId = req.user.id;
        const story = await getVisibleStoryForUser(storyId, userId);
        if (!story) {
            return res.status(404).json({ error: "Story not available" });
        }

        const existing = await pool.query(
            'SELECT 1 FROM story_likes WHERE story_id = $1 AND user_id = $2',
            [storyId, userId]
        );

        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM story_likes WHERE story_id = $1 AND user_id = $2', [storyId, userId]);
            const refreshed = await getStoryInteractions(storyId, userId);
            return res.json({ success: true, status: 'unliked', like_count: refreshed.like_count, is_liked: false });
        }

        await pool.query('INSERT INTO story_likes (story_id, user_id) VALUES ($1, $2)', [storyId, userId]);
        const refreshed = await getStoryInteractions(storyId, userId);
        res.json({ success: true, status: 'liked', like_count: refreshed.like_count, is_liked: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stories/:id/comments', authenticateToken, async (req, res) => {
    try {
        await cleanupExpiredStories();
        const storyId = req.params.id;
        const userId = req.user.id;
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Story comment required" });
        }

        const story = await getVisibleStoryForUser(storyId, userId);
        if (!story) {
            return res.status(404).json({ error: "Story not available" });
        }

        const result = await pool.query(
            `INSERT INTO story_comments (story_id, user_id, text)
             VALUES ($1, $2, $3)
             RETURNING id, story_id, text, created_at, updated_at`,
            [storyId, userId, text.trim()]
        );

        res.json({
            success: true,
            comment: {
                ...result.rows[0],
                user_id: userId,
                username: req.user.username,
                profile_pic: req.user.profile_pic,
            },
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/stories/:id', authenticateToken, async (req, res) => {
    try {
        await cleanupExpiredStories();
        const storyId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query('SELECT * FROM stories WHERE id = $1 AND user_id = $2', [storyId, userId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        await pool.query('DELETE FROM stories WHERE id = $1', [storyId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/avatar', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Avatar image required' });
        }
        const uploadedAsset = await uploadImageAsset(req.file, 'instagram-clone/avatars');
        await pool.query('UPDATE users SET profile_pic = $1 WHERE id = $2', [uploadedAsset.secureUrl, req.user.id]);
        res.json({ success: true, profile_pic: uploadedAsset.secureUrl });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/avatar', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE users SET profile_pic = NULL WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/search', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length === 0) return res.json([]);
        const currentUserId = req.user.id;
        let result;
        try {
            const query = `SELECT u.id, u.username, u.profile_pic, (SELECT status FROM follows WHERE follower_id = $1 AND following_id = u.id) as follow_status FROM users u WHERE (u.username % $2 OR u.username ILIKE $3) AND u.id != $1 ORDER BY similarity(u.username, $2) DESC LIMIT 20`;
            result = await pool.query(query, [currentUserId, q, `%${q}%`]);
        } catch (trgmErr) {
            const query = `SELECT u.id, u.username, u.profile_pic, (SELECT status FROM follows WHERE follower_id = $1 AND following_id = u.id) as follow_status FROM users u WHERE u.username ILIKE $2 AND u.id != $1 ORDER BY u.username ASC LIMIT 20`;
            result = await pool.query(query, [currentUserId, `%${q}%`]);
        }
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:id/followers', authenticateToken, async (req, res) => {
    try {
        const query = `SELECT u.id, u.username, u.profile_pic FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = $1 AND f.status = 'accepted'`;
        const result = await pool.query(query, [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:id/following', authenticateToken, async (req, res) => {
    try {
        const query = `SELECT u.id, u.username, u.profile_pic FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = $1 AND f.status = 'accepted'`;
        const result = await pool.query(query, [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/explore', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const limit = parseLimit(req.query.limit, 30, 90);
        const offset = parseOffset(req.query.offset, 0);
        const seed = getFeedSeed(req.query.seed);
        const profile = await getUserRecommendationProfile(currentUserId);
        const candidates = await fetchRecommendationCandidates(currentUserId, seed, profile.interest_embedding);
        const posts = buildRecommendationPage(candidates, {
            limit,
            offset,
            surface: 'explore',
            hasSignals: profile.has_signals,
            hasFollows: profile.has_follows,
        });
        res.json(posts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== EXPLORE (AI-POWERED) ====================
app.get('/api/explore', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;

        // Check if user has an interest embedding (built from liked posts)
        const userResult = await pool.query('SELECT interest_embedding FROM users WHERE id = $1', [currentUserId]);
        const userEmbedding = userResult.rows[0]?.interest_embedding;

        let result;

        if (userEmbedding && userEmbedding.length > 0) {
            // AI-RANKED: Use cosine similarity to rank posts by relevance to user's interests
            const query = `
                SELECT sub.*, 
                    COALESCE(JSON_AGG(pi.image_url) FILTER (WHERE pi.image_url IS NOT NULL), '[]') as images
                FROM (
                    SELECT p.id, p.caption, p.created_at, p.user_id, u.username, u.profile_pic,
                        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
                        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
                        EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) as is_liked,
                        EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) as is_saved,
                        CASE 
                            WHEN p.embedding IS NOT NULL THEN cosine_similarity(p.embedding, $2::DOUBLE PRECISION[])
                            ELSE 0
                        END as similarity_score
                    FROM posts p
                    JOIN users u ON p.user_id = u.id
                    WHERE p.user_id != $1
                      AND (
                          u.is_private = false
                          OR u.id IN (SELECT following_id FROM follows WHERE follower_id = $1 AND status = 'accepted')
                      )
                    ORDER BY similarity_score DESC, p.created_at DESC
                    LIMIT 30
                ) sub
                LEFT JOIN post_images pi ON sub.id = pi.post_id
                GROUP BY sub.id, sub.caption, sub.created_at, sub.user_id, sub.username, sub.profile_pic,
                         sub.like_count, sub.comment_count, sub.is_liked, sub.is_saved, sub.similarity_score
                ORDER BY sub.similarity_score DESC, sub.created_at DESC
            `;
            result = await pool.query(query, [currentUserId, userEmbedding]);
            console.log(`🧠 Explore: AI-ranked ${result.rows.length} posts for user ${currentUserId}`);
        } else {
            // FALLBACK: No interest profile yet — return random posts (same as before)
            const query = `
                SELECT p.id, p.caption, p.created_at, p.user_id, u.username, u.profile_pic,
                COALESCE(JSON_AGG(pi.image_url) FILTER (WHERE pi.image_url IS NOT NULL), '[]') as images,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) as is_liked,
                EXISTS(SELECT 1 FROM saved_posts WHERE post_id = p.id AND user_id = $1) as is_saved
                FROM posts p
                JOIN users u ON p.user_id = u.id
                LEFT JOIN post_images pi ON p.id = pi.post_id
                WHERE p.user_id != $1
                  AND (
                      u.is_private = false
                      OR u.id IN (SELECT following_id FROM follows WHERE follower_id = $1 AND status = 'accepted')
                  )
                GROUP BY p.id, u.id
                ORDER BY RANDOM()
                LIMIT 30
            `;
            result = await pool.query(query, [currentUserId]);
            console.log(`🎲 Explore: Random ${result.rows.length} posts for user ${currentUserId} (no interest profile yet)`);
        }

        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== SAVED POSTS ====================
app.post('/api/posts/:id/save', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query('SELECT * FROM saved_posts WHERE post_id = $1 AND user_id = $2', [postId, userId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM saved_posts WHERE post_id = $1 AND user_id = $2', [postId, userId]);
            res.json({ status: 'unsaved' });
        } else {
            await pool.query('INSERT INTO saved_posts (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
            res.json({ status: 'saved' });
        }
        queueInterestEmbeddingRefresh(userId);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:id/interest', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        const { feedback } = req.body;
        const normalizedFeedback = feedback === 'none' ? null : feedback;

        if (normalizedFeedback !== null && !['interested', 'not_interested'].includes(normalizedFeedback)) {
            return res.status(400).json({ error: 'Invalid feedback option' });
        }

        const visibilityCheck = await pool.query(`
            SELECT p.id
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = $1
              AND p.user_id <> $2
              AND (
                  u.is_private = false
                  OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $2 AND status = 'accepted')
              )
        `, [postId, userId]);

        if (visibilityCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Post not available' });
        }

        if (!normalizedFeedback) {
            await pool.query(
                'DELETE FROM post_interest_feedback WHERE post_id = $1 AND user_id = $2',
                [postId, userId]
            );
            res.json({ success: true, feedback: 'none' });
            queueInterestEmbeddingRefresh(userId);
            return;
        }

        await pool.query(`
            INSERT INTO post_interest_feedback (post_id, user_id, feedback, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            ON CONFLICT (post_id, user_id)
            DO UPDATE SET feedback = EXCLUDED.feedback, updated_at = NOW()
        `, [postId, userId, normalizedFeedback]);

        res.json({ success: true, feedback: normalizedFeedback });
        queueInterestEmbeddingRefresh(userId);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/saved', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const query = `
            SELECT p.id, p.caption, p.created_at, p.user_id, u.username, u.profile_pic,
            COALESCE(JSON_AGG(pi.image_url) FILTER (WHERE pi.image_url IS NOT NULL), '[]') as images,
            (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
            EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) as is_liked,
            true as is_saved
            FROM saved_posts sp
            JOIN posts p ON sp.post_id = p.id
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_images pi ON p.id = pi.post_id
            WHERE sp.user_id = $1
            GROUP BY p.id, u.id, sp.created_at
            ORDER BY sp.created_at DESC
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== CONVERSATIONS & MESSAGES ====================

// Get or create conversation between two users
app.post('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const myId = req.user.id;
        const { userId: otherId } = req.body;
        if (!otherId || parseInt(otherId) === parseInt(myId)) return res.status(400).json({ error: "Invalid user" });

        // Check if conversation already exists between these two users
        const existing = await pool.query(`
            SELECT cp1.conversation_id FROM conversation_participants cp1
            JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
            WHERE cp1.user_id = $1 AND cp2.user_id = $2
        `, [myId, otherId]);

        if (existing.rows.length > 0) {
            return res.json({ conversation_id: existing.rows[0].conversation_id });
        }

        // Create new conversation
        const conv = await pool.query('INSERT INTO conversations DEFAULT VALUES RETURNING id');
        const convId = conv.rows[0].id;
        await pool.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)', [convId, myId, otherId]);
        res.json({ conversation_id: convId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get inbox (all conversations for current user)
app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const myId = req.user.id;        const query = `
            SELECT c.id, c.updated_at,
                u.id as other_user_id, u.username as other_username, u.profile_pic as other_profile_pic,
                u.last_active as other_last_active,
                (SELECT m.text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_text,
                (SELECT m.image_url FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_image,
                (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
                (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_sender_id,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != $1 AND m.is_read = false) as unread_count
            FROM conversations c
            JOIN conversation_participants cp ON c.id = cp.conversation_id
            JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id != $1
            JOIN users u ON cp2.user_id = u.id
            WHERE cp.user_id = $1
            ORDER BY COALESCE((SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1), c.created_at) DESC
        `;        const result = await pool.query(query, [myId]);
        // Add online status and last_active
        const convos = result.rows.map(r => ({
            ...r,
            is_online: onlineUsers.has(parseInt(r.other_user_id)),
            other_last_active: r.other_last_active || null
        }));
        res.json(convos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get messages for a conversation
app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const convId = req.params.id;
        const myId = req.user.id;
        // Verify user is part of this conversation
        const check = await pool.query('SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [convId, myId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });        // Mark messages as read
        await pool.query('UPDATE messages SET is_read = true WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false', [convId, myId]);
        const result = await pool.query(`
            SELECT m.id, m.text, m.image_url, m.sender_id, m.is_read, m.created_at,
                   m.edited_at, m.original_text, m.reply_to_id,
                   u.username, u.profile_pic,
                   rm.text as reply_text, rm.sender_id as reply_sender_id, ru.username as reply_username
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            LEFT JOIN messages rm ON m.reply_to_id = rm.id
            LEFT JOIN users ru ON rm.sender_id = ru.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC
        `, [convId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send a message
app.post('/api/conversations/:id/messages', authenticateToken, upload.single('image'), async (req, res) => {
    try {        const convId = req.params.id;
        const myId = req.user.id;
        const { text, reply_to_id } = req.body;
        const uploadedAsset = req.file ? await uploadImageAsset(req.file, 'instagram-clone/messages') : null;
        const imageUrl = uploadedAsset ? uploadedAsset.secureUrl : null;
        if (!text && !imageUrl) return res.status(400).json({ error: "Message cannot be empty" });

        // Verify user is part of this conversation
        const check = await pool.query('SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [convId, myId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });

        const replyId = reply_to_id ? parseInt(reply_to_id) : null;
        const result = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, text, image_url, reply_to_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, text, image_url, sender_id, is_read, created_at, reply_to_id',
            [convId, myId, text || null, imageUrl, replyId]
        );
        // Update conversation timestamp
        await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [convId]);        const sender = await pool.query('SELECT username, profile_pic FROM users WHERE id = $1', [myId]);
        const message = { ...result.rows[0], username: sender.rows[0].username, profile_pic: sender.rows[0].profile_pic, edited_at: null, original_text: null };

        // If reply, attach reply data
        if (replyId) {
            const replyData = await pool.query('SELECT m.text, m.sender_id, u.username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1', [replyId]);
            if (replyData.rows.length > 0) {
                message.reply_text = replyData.rows[0].text;
                message.reply_sender_id = replyData.rows[0].sender_id;
                message.reply_username = replyData.rows[0].username;
            }
        }

        // Emit real-time message to the conversation room
        io.to(`chat_${convId}`).emit('new_message', { conversationId: parseInt(convId), message });

        // Also notify the other user (for inbox update / badge) even if they aren't in the chat room
        const participants = await pool.query('SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2', [convId, myId]);
        participants.rows.forEach(p => {
            emitToUser(p.user_id, 'notification_update', {});
            emitToUser(p.user_id, 'inbox_update', { conversationId: parseInt(convId), message });
        });

        res.json(message);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Time limit for edit/delete (12 hours in ms)
const MSG_ACTION_TIME_LIMIT = 12 * 60 * 60 * 1000;

// Edit a message (own only, within time limit)
app.put('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const msgId = req.params.id;
        const myId = req.user.id;
        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: "Message text required" });
        const check = await pool.query('SELECT * FROM messages WHERE id = $1 AND sender_id = $2', [msgId, myId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        const msg = check.rows[0];
        // Check time limit
        const elapsed = Date.now() - new Date(msg.created_at).getTime();
        if (elapsed > MSG_ACTION_TIME_LIMIT) return res.status(403).json({ error: "Cannot edit message after 12 hours" });
        // Store original text on first edit only
        const originalText = msg.original_text || msg.text;
        await pool.query('UPDATE messages SET text = $1, edited_at = NOW(), original_text = $2 WHERE id = $3', [text.trim(), originalText, msgId]);
        const convId = msg.conversation_id;
        const updated = { id: parseInt(msgId), text: text.trim(), edited_at: new Date().toISOString(), original_text: originalText };
        // Emit edit to chat room
        io.to(`chat_${convId}`).emit('message_edited', { conversationId: convId, message: updated });
        res.json({ success: true, ...updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a message (own only, within time limit)
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const msgId = req.params.id;
        const myId = req.user.id;
        const check = await pool.query('SELECT * FROM messages WHERE id = $1 AND sender_id = $2', [msgId, myId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        const msg = check.rows[0];
        // Check time limit
        const elapsed = Date.now() - new Date(msg.created_at).getTime();
        if (elapsed > MSG_ACTION_TIME_LIMIT) return res.status(403).json({ error: "Cannot delete message after 12 hours" });
        const convId = msg.conversation_id;
        await pool.query('DELETE FROM messages WHERE id = $1', [msgId]);
        // Emit deletion to chat room
        io.to(`chat_${convId}`).emit('message_deleted', { conversationId: convId, messageId: parseInt(msgId) });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mark conversation as read
app.put('/api/conversations/:id/read', authenticateToken, async (req, res) => {
    try {
        const convId = req.params.id;
        const myId = req.user.id;
        await pool.query('UPDATE messages SET is_read = true WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false', [convId, myId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== NOTIFICATION COUNTS ====================
app.get('/api/notifications/count', authenticateToken, async (req, res) => {
    try {
        const myId = req.user.id;
        // Unread messages count (across all conversations)
        const msgResult = await pool.query(`
            SELECT COUNT(*) as count FROM messages m
            JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
            WHERE cp.user_id = $1 AND m.sender_id != $1 AND m.is_read = false
        `, [myId]);
        // Pending follow requests count
        const reqResult = await pool.query(`
            SELECT COUNT(*) as count FROM follows WHERE following_id = $1 AND status = 'pending'
        `, [myId]);
        const activity = await countUnreadActivityNotifications(myId);
        const messages = parseInt(msgResult.rows[0].count);
        const requests = parseInt(reqResult.rows[0].count);
        const notifications = requests + activity;
        res.json({ messages, requests, activity, notifications, total: messages + notifications });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = 8080;
cleanupExpiredStories()
    .then((removedCount) => {
        if (removedCount > 0) {
            console.log(`Cleaned up ${removedCount} expired stories on startup`);
        }
    })
    .catch((error) => console.error('Expired story cleanup failed:', error.message));

setInterval(() => {
    cleanupExpiredStories().catch((error) => {
        console.error('Scheduled story cleanup failed:', error.message);
    });
}, STORY_CLEANUP_INTERVAL_MS);
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
