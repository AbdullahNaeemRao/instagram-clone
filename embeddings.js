const { InferenceClient } = require('@huggingface/inference');

const HF_MODEL = process.env.HF_TEXT_EMBEDDING_MODEL || 'sentence-transformers/all-MiniLM-L6-v2';
const HF_TOKEN = process.env.HF_API_TOKEN || null;
const LOCAL_EMBEDDING_DIMENSIONS = 384;

const hfClient = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hashToken(token, seed = 0) {
    let hash = 2166136261 ^ seed;
    for (let i = 0; i < token.length; i += 1) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function buildLocalEmbedding(text, dimensions = LOCAL_EMBEDDING_DIMENSIONS) {
    const normalized = normalizeText(text);
    if (!normalized) {
        return null;
    }

    const tokens = normalized.split(' ').filter(Boolean);
    const vector = new Array(dimensions).fill(0);

    tokens.forEach((token, index) => {
        const primaryIndex = hashToken(token, index) % dimensions;
        const secondaryIndex = hashToken(token, index + 97) % dimensions;
        const tertiaryIndex = hashToken(token, index + 193) % dimensions;
        const weight = Math.min(3, 1 + (token.length / 8));

        vector[primaryIndex] += weight;
        vector[secondaryIndex] -= weight * 0.35;
        vector[tertiaryIndex] += weight * 0.2;

        if (index < tokens.length - 1) {
            const bigram = `${token}_${tokens[index + 1]}`;
            const bigramIndex = hashToken(bigram, 313) % dimensions;
            vector[bigramIndex] += 0.75;
        }
    });

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
    if (!norm) {
        return null;
    }

    return vector.map((value) => Number((value / norm).toFixed(6)));
}

async function generateEmbedding(text) {
    if (!text || text.trim().length === 0) return null;

    if (!hfClient) {
        return buildLocalEmbedding(text);
    }

    try {
        const embedding = await hfClient.featureExtraction({
            model: HF_MODEL,
            inputs: text.trim(),
        });

        if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
            return embedding[0];
        }
        if (Array.isArray(embedding) && typeof embedding[0] === 'number') {
            return embedding;
        }

        console.warn('Unexpected embedding format from Hugging Face client');
        return buildLocalEmbedding(text);
    } catch (err) {
        console.error('Embedding inference error:', err.message);
        return buildLocalEmbedding(text);
    }
}

function averageVectors(vectors) {
    const valid = vectors.filter(v => v && v.length > 0);
    if (valid.length === 0) return null;
    const dim = valid[0].length;
    const sum = new Array(dim).fill(0);
    for (const vec of valid) {
        for (let i = 0; i < dim; i++) {
            sum[i] += vec[i];
        }
    }
    return sum.map(s => s / valid.length);
}

module.exports = { generateEmbedding, averageVectors, buildLocalEmbedding };
