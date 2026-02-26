const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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

// ==================== POSTS ====================
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
        const currentUserId = req.user.id;
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

// ==================== COMMENTS ====================
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
            // Notify target about updated notifications
            emitToUser(targetId, 'notification_update', {});
            res.json({ status: "none" });
        } else {
            const target = await pool.query('SELECT is_private FROM users WHERE id = $1', [targetId]);
            const isPrivate = target.rows[0].is_private;
            const status = isPrivate ? 'pending' : 'accepted';
            await pool.query('INSERT INTO follows (follower_id, following_id, status) VALUES ($1, $2, $3)', [followerId, targetId, status]);
            // Notify target about new follow/request
            emitToUser(targetId, 'notification_update', {});
            res.json({ status: status });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/requests', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const query = `
            SELECT f.follower_id, u.username, u.profile_pic, f.created_at
            FROM follows f 
            JOIN users u ON f.follower_id = u.id 
            WHERE f.following_id = $1 AND f.status = 'pending'
            ORDER BY f.created_at DESC
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/requests/:id/confirm', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query("UPDATE follows SET status = 'accepted' WHERE follower_id = $1 AND following_id = $2", [followerId, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/requests/:id/delete', authenticateToken, async (req, res) => {
    try {
        const followerId = req.params.id;
        const userId = req.user.id;
        await pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, userId]);
        res.json({ success: true });
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

// ==================== STORIES, AVATAR, SEARCH ====================
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

// ==================== EXPLORE ====================
app.get('/api/explore', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;
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
        const imageUrl = req.file ? `http://localhost:8080/uploads/${req.file.filename}` : null;
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
        const messages = parseInt(msgResult.rows[0].count);
        const requests = parseInt(reqResult.rows[0].count);
        res.json({ messages, requests, total: messages + requests });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = 8080;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));