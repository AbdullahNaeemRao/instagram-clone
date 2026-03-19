const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { InferenceClient } = require('@huggingface/inference');
const { createWorker } = require('tesseract.js');
const { generateEmbedding } = require('./embeddings');

const HF_TOKEN = process.env.HF_API_TOKEN || null;
const IMAGE_TO_TEXT_MODEL = process.env.HF_IMAGE_TO_TEXT_MODEL || 'Salesforce/blip-image-captioning-base';
const IMAGE_CLASSIFICATION_MODEL = process.env.HF_IMAGE_CLASSIFICATION_MODEL || 'google/vit-base-patch16-224';
const MAX_ANALYZED_IMAGES = Number(process.env.POST_ANALYSIS_IMAGE_LIMIT || 3);
const OCR_INIT_TIMEOUT_MS = Number(process.env.OCR_INIT_TIMEOUT_MS || 45000);
const OCR_JOB_TIMEOUT_MS = Number(process.env.OCR_JOB_TIMEOUT_MS || 30000);
const hfVisionClient = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

const CATEGORY_PROFILES = {
    'Gaming': {
        summary: 'video games esports streaming controllers PC setup ranked matches boss fights and gaming clips',
        keywords: {
            gaming: 4, gamer: 4, game: 2, games: 2, esports: 4, streamer: 3, streaming: 3,
            controller: 3, keyboard: 2, headset: 2, xbox: 3, playstation: 3, nintendo: 3,
            steam: 2, ranked: 3, fps: 2, battle: 1, boss: 2, respawn: 2, loot: 2,
        },
        hashtags: ['gaming', 'gamerlife', 'esports', 'streaming', 'pcsetup', 'gg'],
    },
    'Army/Military': {
        summary: 'military training soldiers uniforms service ruck drills base leadership discipline and defense',
        keywords: {
            military: 5, army: 5, soldier: 4, troops: 3, training: 2, uniform: 3, combat: 3,
            service: 2, defense: 3, tactical: 3, ruck: 4, barracks: 3, platoon: 4,
            field: 2, brigade: 4, lieutenant: 3, sergeant: 3, discipline: 2,
        },
        hashtags: ['militarylife', 'army', 'discipline', 'trainingday', 'leadership', 'service'],
    },
    'News': {
        summary: 'newsroom headlines journalism breaking updates reports media press current affairs and live coverage',
        keywords: {
            news: 5, headline: 4, headlines: 4, breaking: 3, journalist: 4, journalism: 4,
            newsroom: 4, reporter: 4, report: 3, reports: 3, press: 3, update: 2,
            bulletin: 3, anchor: 3, media: 2, current: 1, affairs: 1, coverage: 2,
        },
        hashtags: ['news', 'journalism', 'breakingnews', 'currentaffairs', 'headlines', 'dailybrief'],
    },
    'Funny Memes': {
        summary: 'funny memes jokes reaction images relatable humor internet comedy and viral posts',
        keywords: {
            meme: 5, memes: 5, funny: 4, humor: 4, hilarious: 4, joke: 4, jokes: 4,
            relatable: 4, reaction: 4, viral: 2, comedy: 3, laughing: 3, sarcasm: 3,
            chaotic: 2, cursed: 3, lol: 3, lmao: 3,
        },
        hashtags: ['meme', 'funnymemes', 'relatable', 'internetculture', 'lol', 'comedygold'],
    },
    'Tech': {
        summary: 'software engineering coding developer laptops AI gadgets programming product design and technology workspaces',
        keywords: {
            tech: 5, technology: 4, code: 4, coding: 4, developer: 4, programming: 4,
            software: 4, engineer: 3, engineering: 3, laptop: 2, keyboard: 1, ai: 4,
            startup: 2, app: 2, debug: 3, debugging: 3, terminal: 3, algorithm: 2,
            product: 2, gadget: 3, gadgets: 3,
        },
        hashtags: ['tech', 'developerlife', 'coding', 'softwareengineering', 'buildinpublic', 'devdesk'],
    },
    'Poetry': {
        summary: 'poetry poems verses stanzas notebooks literary writing emotions prose and spoken word',
        keywords: {
            poetry: 5, poem: 5, poems: 5, poet: 4, poets: 4, verse: 4, verses: 4,
            stanza: 4, literary: 3, notebook: 2, writing: 2, writer: 2, metaphor: 3,
            rhyme: 3, prose: 3, spoken: 2, word: 1, lines: 2, ink: 2,
        },
        hashtags: ['poetry', 'poem', 'poetsofinstagram', 'writingcommunity', 'verse', 'englishpoetry'],
    },
    'Graphic Design': {
        summary: 'graphic design typography posters layouts branding logos grids color palettes and visual identity',
        keywords: {
            design: 2, graphic: 5, typography: 5, poster: 4, layout: 4, branding: 4,
            logo: 4, logos: 4, grid: 4, kerning: 4, typeface: 4, font: 4,
            palette: 3, composition: 3, adobe: 2, illustrator: 3, photoshop: 3,
            mockup: 3, visual: 2, identity: 2,
        },
        hashtags: ['graphicdesign', 'typography', 'posterdesign', 'brandidentity', 'layout', 'designprocess'],
    },
};

let ocrWorkerPromise = null;
let ocrQueue = Promise.resolve();
let categoryEmbeddingPromise = null;
let ocrDisabledReason = null;
const localTesseractDataDir = fs.existsSync(path.join(__dirname, 'eng.traineddata')) ? __dirname : null;

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueValues(list) {
    return [...new Set(list.filter(Boolean))];
}

function tokenizeText(text) {
    return normalizeWhitespace(text)
        .toLowerCase()
        .replace(/[^a-z0-9#\s/-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (!normA || !normB) {
        return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getOcrWorker() {
    if (ocrDisabledReason) {
        return null;
    }

    if (!ocrWorkerPromise) {
        ocrWorkerPromise = Promise.race([
            createWorker('eng', 1, {
                ...(localTesseractDataDir ? { langPath: localTesseractDataDir, gzip: false } : {}),
                errorHandler: (error) => {
                    const message = normalizeWhitespace(error);
                    if (!message) {
                        return;
                    }
                    ocrDisabledReason = message;
                    console.error('OCR worker error:', ocrDisabledReason);
                },
            }),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('OCR initialization timed out'));
                }, OCR_INIT_TIMEOUT_MS);
            }),
        ]).catch((error) => {
            const message = normalizeWhitespace(error.message || error);
            if (/timed out/i.test(message)) {
                console.warn(message);
            } else {
                ocrDisabledReason = message;
                console.error('OCR initialization failed:', message);
            }
            ocrWorkerPromise = null;
            return null;
        });
    }
    return ocrWorkerPromise;
}

async function withOcrQueue(task) {
    const previous = ocrQueue;
    let release;
    ocrQueue = new Promise((resolve) => {
        release = resolve;
    });

    await previous;
    try {
        return await task();
    } finally {
        release();
    }
}

function normalizeImageSource(imageSource) {
    if (!imageSource) {
        return null;
    }

    if (typeof imageSource === 'string') {
        if (/^https?:\/\//i.test(imageSource)) {
            return { url: imageSource, label: imageSource, originalName: path.basename(new URL(imageSource).pathname) };
        }
        return { path: imageSource, label: imageSource, originalName: path.basename(imageSource) };
    }

    if (Buffer.isBuffer(imageSource)) {
        return { buffer: imageSource, label: 'buffer-image', originalName: 'buffer-image' };
    }

    if (typeof imageSource === 'object') {
        return {
            ...imageSource,
            label: imageSource.label || imageSource.url || imageSource.path || imageSource.originalName || 'image-source',
        };
    }

    return null;
}

function getImageExtension(imageSource) {
    const source = normalizeImageSource(imageSource);
    if (!source) {
        return '';
    }

    if (String(source.mimeType || '').startsWith('image/')) {
        const subtype = String(source.mimeType).split('/')[1] || '';
        return `.${subtype.toLowerCase()}`;
    }

    const candidate = source.originalName || source.path || source.url || '';
    try {
        if (/^https?:\/\//i.test(candidate)) {
            return path.extname(new URL(candidate).pathname || '').toLowerCase();
        }
    } catch (error) {
        // Fall through to generic path handling.
    }

    return path.extname(String(candidate)).toLowerCase();
}

function isSupportedImageSource(imageSource) {
    const source = normalizeImageSource(imageSource);
    if (!source) {
        return false;
    }
    if (String(source.mimeType || '').startsWith('image/')) {
        return true;
    }
    return /\.(png|jpe?g|bmp|gif|webp|tiff?)$/i.test(getImageExtension(source));
}

async function loadImageBuffer(imageSource) {
    const source = normalizeImageSource(imageSource);
    if (!source) {
        return null;
    }

    if (Buffer.isBuffer(source.buffer)) {
        return source.buffer;
    }

    if (source.path) {
        return fsp.readFile(source.path);
    }

    if (source.url) {
        const response = await axios.get(source.url, {
            responseType: 'arraybuffer',
            timeout: 15000,
        });
        return Buffer.from(response.data);
    }

    return null;
}

async function extractImageText(imageSource) {
    const source = normalizeImageSource(imageSource);
    if (!isSupportedImageSource(source)) {
        return { text: '', confidence: 0 };
    }

    try {
        return await withOcrQueue(async () => {
            const worker = await getOcrWorker();
            if (!worker) {
                return { text: '', confidence: 0 };
            }
            const imageBuffer = await loadImageBuffer(source);
            if (!imageBuffer) {
                return { text: '', confidence: 0 };
            }
            const result = await Promise.race([
                worker.recognize(imageBuffer),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('OCR recognition timed out')), OCR_JOB_TIMEOUT_MS);
                }),
            ]);
            return {
                text: normalizeWhitespace(result?.data?.text),
                confidence: Number(result?.data?.confidence || 0),
            };
        });
    } catch (error) {
        const message = normalizeWhitespace(error.message || error);
        if (/timed out/i.test(message)) {
            console.warn(`OCR timed out for ${source?.label || 'image'}: ${message}`);
            ocrWorkerPromise = null;
        } else {
            ocrDisabledReason = message;
            console.error(`OCR failed for ${source?.label || 'image'}:`, message);
        }
        return { text: '', confidence: 0 };
    }
}

async function queryImageModel(model, imageSource) {
    if (!hfVisionClient) {
        return null;
    }

    try {
        const source = normalizeImageSource(imageSource);
        const imageBuffer = await loadImageBuffer(source);
        if (!imageBuffer) {
            return null;
        }
        return { imageBuffer, model };
    } catch (error) {
        const source = normalizeImageSource(imageSource);
        console.error(`Image model ${model} failed for ${source?.label || 'image'}:`, error.message);
        return null;
    }
}

async function captionImage(imageSource) {
    const request = await queryImageModel(IMAGE_TO_TEXT_MODEL, imageSource);
    if (!request) {
        return '';
    }

    try {
        const data = await hfVisionClient.imageToText({
            data: request.imageBuffer,
            model: request.model,
        });
        if (typeof data?.generated_text === 'string') {
            return normalizeWhitespace(data.generated_text);
        }
        if (Array.isArray(data) && data[0]?.generated_text) {
            return normalizeWhitespace(data[0].generated_text);
        }
    } catch (error) {
        const source = normalizeImageSource(imageSource);
        console.error(`Image captioning failed for ${source?.label || 'image'}:`, error.message);
    }
    return '';
}

async function classifyImage(imageSource) {
    const request = await queryImageModel(IMAGE_CLASSIFICATION_MODEL, imageSource);
    if (!request) {
        return [];
    }

    try {
        const data = await hfVisionClient.imageClassification({
            data: request.imageBuffer,
            model: request.model,
        });
        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .filter((item) => item && typeof item.label === 'string')
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
            .slice(0, 5)
            .map((item) => normalizeWhitespace(item.label.toLowerCase()));
    } catch (error) {
        const source = normalizeImageSource(imageSource);
        console.error(`Image classification failed for ${source?.label || 'image'}:`, error.message);
        return [];
    }
}

function extractHashtags(text) {
    return uniqueValues(
        (String(text || '').match(/#([a-z0-9_]+)/gi) || [])
            .map((tag) => tag.replace(/^#/, '').toLowerCase())
    );
}

function inferExtraTags(category, text) {
    const profile = CATEGORY_PROFILES[category];
    if (!profile) {
        return [];
    }

    const normalized = ` ${normalizeWhitespace(text).toLowerCase()} `;
    return Object.keys(profile.keywords)
        .filter((keyword) => normalized.includes(` ${keyword} `))
        .slice(0, 4)
        .map((keyword) => keyword.replace(/[^a-z0-9]+/g, ''))
        .filter(Boolean);
}

function buildHashtags(category, text) {
    const profile = CATEGORY_PROFILES[category];
    const hashtags = [
        ...extractHashtags(text),
        ...(profile ? profile.hashtags : []),
        ...inferExtraTags(category, text),
    ];

    return uniqueValues(
        hashtags
            .map((tag) => tag.toLowerCase().replace(/[^a-z0-9]+/g, ''))
            .filter(Boolean)
    ).slice(0, 8);
}

async function getCategoryEmbeddings() {
    if (!categoryEmbeddingPromise) {
        categoryEmbeddingPromise = Promise.all(
            Object.entries(CATEGORY_PROFILES).map(async ([category, profile]) => ({
                category,
                embedding: await generateEmbedding(profile.summary),
            }))
        );
    }

    return categoryEmbeddingPromise;
}

function classifyByKeywords(text) {
    const normalized = ` ${normalizeWhitespace(text).toLowerCase()} `;
    const scores = Object.fromEntries(Object.keys(CATEGORY_PROFILES).map((category) => [category, 0]));

    Object.entries(CATEGORY_PROFILES).forEach(([category, profile]) => {
        Object.entries(profile.keywords).forEach(([keyword, weight]) => {
            if (normalized.includes(` ${keyword} `)) {
                scores[category] += weight;
            }
        });

        if (category === 'Poetry' && String(text || '').includes('\n')) {
            scores[category] += 1.5;
        }
    });

    return scores;
}

async function inferCategory(text, analysisEmbedding) {
    const keywordScores = classifyByKeywords(text);
    const embeddingScores = {};

    if (analysisEmbedding) {
        const categoryEmbeddings = await getCategoryEmbeddings();
        categoryEmbeddings.forEach(({ category, embedding }) => {
            embeddingScores[category] = embedding ? cosineSimilarity(analysisEmbedding, embedding) : 0;
        });
    }

    const ranked = Object.keys(CATEGORY_PROFILES)
        .map((category) => {
            const keywordScore = keywordScores[category] || 0;
            const embeddingScore = Math.max(0, embeddingScores[category] || 0);
            const combinedScore = (keywordScore * 1.35) + (embeddingScore * 6);
            return { category, keywordScore, embeddingScore, combinedScore };
        })
        .sort((a, b) => b.combinedScore - a.combinedScore);

    const top = ranked[0] || { category: null, combinedScore: 0 };
    const runnerUp = ranked[1] || { combinedScore: 0 };
    if (!top.combinedScore) {
        return {
            category: null,
            confidence: 0,
            ranked,
        };
    }
    const margin = Math.max(0, top.combinedScore - runnerUp.combinedScore);
    const confidence = Number(Math.min(0.99, Math.max(0.15, (top.combinedScore / 12) + (margin / 18))).toFixed(3));

    return {
        category: top.category,
        confidence,
        ranked,
    };
}

function buildAnalysisText({ caption, ocrText, visionCaption, visionLabels }) {
    return normalizeWhitespace([
        caption,
        ocrText,
        visionCaption,
        Array.isArray(visionLabels) ? visionLabels.join(' ') : '',
    ].filter(Boolean).join(' '));
}

async function analyzeSingleImage(imageSource) {
    const source = normalizeImageSource(imageSource);
    const [ocrResult, visionCaption, visionLabels] = await Promise.all([
        extractImageText(source),
        captionImage(source),
        classifyImage(source),
    ]);

    return {
        imageSource: source?.label || null,
        ocrText: ocrResult.text,
        ocrConfidence: ocrResult.confidence,
        visionCaption,
        visionLabels,
    };
}

async function analyzePostIntelligence({ caption, imageSources, imagePaths }) {
    const rawSources = Array.isArray(imageSources) ? imageSources : imagePaths;
    const analysisTargets = (Array.isArray(rawSources) ? rawSources : []).filter(Boolean).slice(0, MAX_ANALYZED_IMAGES);
    const imageAnalyses = await Promise.all(analysisTargets.map((imageSource) => analyzeSingleImage(imageSource)));

    const ocrText = normalizeWhitespace(imageAnalyses.map((item) => item.ocrText).filter(Boolean).join(' '));
    const visionCaption = normalizeWhitespace(imageAnalyses.map((item) => item.visionCaption).filter(Boolean).join(' '));
    const visionLabels = uniqueValues(imageAnalyses.flatMap((item) => item.visionLabels || []));
    const analysisText = buildAnalysisText({ caption, ocrText, visionCaption, visionLabels });
    const embedding = await generateEmbedding(analysisText || caption || '');
    const categoryResult = await inferCategory(analysisText || caption || '', embedding);
    const hashtags = buildHashtags(categoryResult.category, analysisText || caption || '');
    const analysisStatus = analysisText || caption ? 'ready' : 'partial';

    return {
        category: categoryResult.category,
        categoryConfidence: categoryResult.confidence,
        hashtags,
        embedding,
        ocrText,
        visionCaption,
        visionLabels,
        analysisText,
        metadata: {
            analysis_status: analysisStatus,
            analysis_confidence: categoryResult.confidence,
            image_analysis: imageAnalyses.map((item) => ({
                image_source: item.imageSource,
                ocr_confidence: item.ocrConfidence,
                vision_caption: item.visionCaption,
                vision_labels: item.visionLabels,
            })),
            analysis_models: {
                ocr: 'tesseract.js',
                image_to_text: IMAGE_TO_TEXT_MODEL,
                image_classification: IMAGE_CLASSIFICATION_MODEL,
                text_embedding: 'sentence-transformers/all-MiniLM-L6-v2',
            },
        },
        analysisStatus,
    };
}

module.exports = {
    analyzePostIntelligence,
};
