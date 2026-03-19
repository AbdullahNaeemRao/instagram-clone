// Backfill script: Generate embeddings for all existing posts that have captions but no embedding yet.
// Also rebuilds interest_embedding for all users based on their liked posts.
// Usage: node backfill_embeddings.js

require('dotenv').config();
const pool = require('./db');
const { generateEmbedding, averageVectors } = require('./embeddings');

async function backfillPosts() {
    console.log('📦 Fetching posts without embeddings...');
    const result = await pool.query(
        "SELECT id, caption FROM posts WHERE embedding IS NULL AND caption IS NOT NULL AND TRIM(caption) != ''"
    );
    console.log(`Found ${result.rows.length} posts to process.`);

    let success = 0, failed = 0;
    for (const post of result.rows) {
        try {
            const embedding = await generateEmbedding(post.caption);
            if (embedding) {
                await pool.query('UPDATE posts SET embedding = $1 WHERE id = $2', [embedding, post.id]);
                success++;
                console.log(`  ✅ Post ${post.id}: "${post.caption.substring(0, 50)}..." → ${embedding.length}d vector`);
            } else {
                failed++;
                console.log(`  ⚠️ Post ${post.id}: No embedding returned`);
            }
        } catch (err) {
            failed++;
            console.error(`  ❌ Post ${post.id}: ${err.message}`);
        }
        // Small delay to avoid rate limiting on HuggingFace free API
        await new Promise(r => setTimeout(r, 500));
    }
    console.log(`\n📊 Posts: ${success} embedded, ${failed} failed out of ${result.rows.length} total.\n`);
}

async function backfillUserInterests() {
    console.log('👤 Rebuilding user interest embeddings from liked posts...');
    const users = await pool.query('SELECT id, username FROM users');
    let updated = 0;

    for (const user of users.rows) {
        const likedPosts = await pool.query(
            'SELECT p.embedding FROM likes l JOIN posts p ON l.post_id = p.id WHERE l.user_id = $1 AND p.embedding IS NOT NULL',
            [user.id]
        );
        if (likedPosts.rows.length > 0) {
            const vectors = likedPosts.rows.map(r => r.embedding);
            const avgVec = averageVectors(vectors);
            if (avgVec) {
                await pool.query('UPDATE users SET interest_embedding = $1 WHERE id = $2', [avgVec, user.id]);
                updated++;
                console.log(`  ✅ ${user.username}: interest profile built from ${vectors.length} liked posts`);
            }
        } else {
            console.log(`  ⏭️ ${user.username}: no liked posts with embeddings, skipping`);
        }
    }
    console.log(`\n📊 Users: ${updated} interest profiles updated out of ${users.rows.length} total.\n`);
}

async function main() {
    console.log('🚀 Starting embedding backfill...\n');
    try {
        await backfillPosts();
        await backfillUserInterests();
        console.log('✅ Backfill complete!');
    } catch (err) {
        console.error('Fatal error:', err);
    } finally {
        await pool.end();
    }
}

main();
