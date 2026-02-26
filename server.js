const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- AUTH ---
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
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ error: "User not found" });
        const user = result.rows[0];
        if (await bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
            res.json({ success: true, token, user: { id: user.id, username: user.username, profile_pic: user.profile_pic } });
        } else { res.status(403).json({ error: "Wrong password" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- POSTS ---
app.post('/api/posts', authenticateToken, upload.array('images', 10), async (req, res) => {
    try {
        const { caption } = req.body;
        const postResult = await pool.query('INSERT INTO posts (user_id, caption) VALUES ($1, $2) RETURNING id', [req.user.id, caption]);
        const postId = postResult.rows[0].id;
        if (req.files && req.files.length > 0) {
            const imageQueries = req.files.map(file => {
                const imageUrl = `http://localhost:8080/uploads/${file.filename}`;
                return pool.query('INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)', [postId, imageUrl]);
            });
            await Promise.all(imageQueries);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/posts', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;        // Feed: Show posts from people I follow (accepted) OR my own posts
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
            WHERE p.user_id = $1 
               OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1 AND status = 'accepted')
            GROUP BY p.id, u.id
            ORDER BY p.created_at DESC
        `;
        const result = await pool.query(query, [currentUserId]);
        res.json(result.rows);
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

// --- COMMENTS ---
app.get('/api/posts/:id/comments', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id; 
        const query = `
            SELECT c.id, c.text, c.created_at, c.user_id, c.is_pinned, u.username, u.profile_pic,
            (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as like_count,
            EXISTS(SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = $2) as is_liked,
            EXISTS(SELECT 1 FROM comment_likes cl JOIN posts p ON p.id = c.post_id WHERE cl.comment_id = c.id AND cl.user_id = p.user_id) as liked_by_author,
            (SELECT u2.profile_pic FROM users u2 JOIN posts p2 ON p2.user_id = u2.id WHERE p2.id = c.post_id) as author_pic
            FROM comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = $1 ORDER BY c.is_pinned DESC, c.created_at ASC
        `;
        const result = await pool.query(query, [postId, userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:id/comments', authenticateToken, async (req, res) => {
    try {
        const postId = req.params.id;
        const { text } = req.body;
        const userId = req.user.id;
        const result = await pool.query('INSERT INTO comments (post_id, user_id, text) VALUES ($1, $2, $3) RETURNING id, created_at, is_pinned', [postId, userId, text]);
        const newComment = { id: result.rows[0].id, text, created_at: result.rows[0].created_at, user_id: userId, username: req.user.username, profile_pic: req.user.profile_pic, is_pinned: false, like_count: 0, is_liked: false, liked_by_author: false };
        res.json({ success: true, comment: newComment });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/comments/:id/like', authenticateToken, async (req, res) => {
    try {
        const commentId = req.params.id;
        const userId = req.user.id;
        const check = await pool.query('SELECT * FROM comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
            res.json({ status: 'unliked' });
        } else {
            await pool.query('INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)', [commentId, userId]);
            res.json({ status: 'liked' });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Edit Comment (owner of comment OR owner of post can edit)
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
        const check = await pool.query(`SELECT c.id FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = $1 AND (c.user_id = $2 OR p.user_id = $2)`, [commentId, userId]);
        if (check.rows.length === 0) return res.status(403).json({ error: "Unauthorized" });
        await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
        res.json({ success: true, message: "Comment deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- PROFILE, PRIVACY & REQUESTS ---

// Get Profile (With Privacy Check)
app.get('/api/users/:username', authenticateToken, async (req, res) => {
    try {
        const { username } = req.params;
        const currentUserId = req.user.id;
        
        // 1. Get User Info & Follow Status
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

        // 2. Privacy Logic: If private AND not following AND not self -> Hide Posts
        if (targetUser.is_private && !isFollowing && !isSelf) {
            return res.json({ user: targetUser, posts: [], restricted: true });
        }        // 3. Get Posts (If allowed)
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

// Toggle Privacy
app.put('/api/users/privacy', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const current = await pool.query('SELECT is_private FROM users WHERE id = $1', [userId]);
        const newStatus = !current.rows[0].is_private;
        await pool.query('UPDATE users SET is_private = $1 WHERE id = $2', [newStatus, userId]);
        res.json({ success: true, is_private: newStatus });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Follow / Unfollow (Updated for Pending)
app.post('/api/follow/:id', authenticateToken, async (req, res) => {
    try {
        const targetId = req.params.id;
        const followerId = req.user.id;
        
        // Check existing
        const check = await pool.query('SELECT * FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, targetId]);
        
        if (check.rows.length > 0) {
            // Unfollow (or un-request)
            await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, targetId]);
            res.json({ status: "none" });
        } else {
            // Check if target is private
            const target = await pool.query('SELECT is_private FROM users WHERE id = $1', [targetId]);
            const isPrivate = target.rows[0].is_private;
            const status = isPrivate ? 'pending' : 'accepted';
            
            await pool.query('INSERT INTO follows (follower_id, following_id, status) VALUES ($1, $2, $3)', [followerId, targetId, status]);
            res.json({ status: status });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Pending Requests (For Heart Icon)
app.get('/api/requests', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const query = `
            SELECT f.follower_id, u.username, u.profile_pic 
            FROM follows f 
            JOIN users u ON f.follower_id = u.id 
            WHERE f.following_id = $1 AND f.status = 'pending'
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Accept Request
app.post('/api/requests/:id/confirm', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query("UPDATE follows SET status = 'accepted' WHERE follower_id = $1 AND following_id = $2", [followerId, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete Request
app.post('/api/requests/:id/delete', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove a follower (removes someone from YOUR followers list)
app.delete('/api/followers/:id', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get current user info (for settings)
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, profile_pic, is_private FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- MISC (STORIES, AVATAR, SEARCH - UNCHANGED) ---
app.post('/api/stories', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const imageUrl = `http://localhost:8080/uploads/${req.file.filename}`;
        await pool.query('INSERT INTO stories (user_id, image_url) VALUES ($1, $2)', [req.user.id, imageUrl]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/stories', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const query = `
            SELECT s.id, s.image_url, s.created_at, u.username, u.profile_pic, s.user_id 
            FROM stories s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.created_at >= NOW() - INTERVAL '24 HOURS'
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
app.delete('/api/stories/:id', authenticateToken, async (req, res) => {
    try {
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
        const imageUrl = `http://localhost:8080/uploads/${req.file.filename}`;
        await pool.query('UPDATE users SET profile_pic = $1 WHERE id = $2', [imageUrl, req.user.id]);
        res.json({ success: true, profile_pic: imageUrl });
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
        // Try trigram search first, fallback to ILIKE if pg_trgm not installed
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

// --- EXPLORE PAGE ---
app.get('/api/explore', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        // Get random posts from:
        // - Public accounts (excluding my own posts)
        // - Private accounts ONLY if I follow them (accepted)
        // Excludes the logged-in user's own posts
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
        const result = await pool.query(query, [currentUserId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SAVED POSTS (BOOKMARKS) ---
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
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));