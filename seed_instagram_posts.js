const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { buildLocalEmbedding } = require('./embeddings');

const args = new Set(process.argv.slice(2));
const schemaOnly = args.has('--schema-only');
const seedOnly = args.has('--seed-only');

if (schemaOnly && seedOnly) {
    console.error('Use either --schema-only or --seed-only, not both.');
    process.exit(1);
}

const TOTAL_POSTS = Number(process.env.INSTAGRAM_POST_SEED_COUNT || 500);
const TARGET_USER_COUNT = Number(process.env.INSTAGRAM_USER_SEED_COUNT || 100);
const RANDOM_SEED = Number(process.env.INSTAGRAM_RANDOM_SEED || 20260313);
const IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || 'local-svg';
const SEED_WITH_INTERACTIONS = process.env.SEED_WITH_INTERACTIONS !== 'false';
const PROTECT_PRIMARY_DEMO_USERS = process.env.SEED_PROTECT_PRIMARY_DEMO_USERS !== 'false';
const SEEDED_EMAIL_DOMAIN = 'seedgram.local';
const DEFAULT_PASSWORD = process.env.SEED_USER_PASSWORD || 'SeedDemo123!';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SEEDED_UPLOADS_DIR = path.join(UPLOADS_DIR, 'seeded');

const CATEGORY_RELATIONS = {
    'Gaming': ['Tech', 'Funny Memes', 'Graphic Design'],
    'Army/Military': ['News', 'Tech', 'Graphic Design'],
    'News': ['Tech', 'Army/Military', 'Poetry'],
    'Funny Memes': ['Gaming', 'Graphic Design', 'Tech'],
    'Tech': ['Gaming', 'Graphic Design', 'News'],
    'Poetry': ['Graphic Design', 'News', 'Funny Memes'],
    'Graphic Design': ['Tech', 'Funny Memes', 'Poetry'],
};

const CATEGORY_CONFIG = {
    'Gaming': {
        usernames: ['pixelraider', 'critstack', 'respawnrelay', 'bossphase', 'midnightcombo'],
        imageKeywords: ['gaming', 'esports', 'pc setup', 'controller', 'stream room', 'rgb desk'],
        subjects: [
            'late-night ranked grind',
            'a clutch overtime round',
            'today\'s duo queue session',
            'a clean boss fight reset',
            'my current indie game obsession',
            'the stream setup after a long patch night',
        ],
        details: [
            'finally felt smooth from start to finish',
            'proved that better positioning beats panic every time',
            'looked chaotic but the team comms stayed sharp',
            'made me rethink my whole loadout',
            'was the exact kind of progress I needed this week',
            'delivered the kind of momentum you chase for hours',
        ],
        moods: [
            'What are you all playing right now?',
            'I am definitely running this back tomorrow',
            'Small adjustments changed everything',
            'The final clip still does not feel real',
            'Practice mode paid off more than expected',
        ],
        hashtags: ['gaming', 'gamerlife', 'esports', 'rankedgrind', 'pcsetup', 'consolegaming', 'gg', 'clutch', 'streamsetup', 'gamingcommunity'],
        searches: ['best gaming setup', 'clutch gaming moments', 'indie game aesthetic', 'ranked gameplay tips', 'stream room inspiration', 'rgb desk ideas'],
        comments: ['That angle was clean.', 'Saving this setup inspiration.', 'The pacing here is excellent.', 'You can feel the grind paying off.', 'This is the kind of post that makes me queue again.'],
        imageMin: 1,
        imageMax: 3,
    },
    'Army/Military': {
        usernames: ['ruckjournal', 'fieldbrief', 'steadybearing', 'formationnotes', 'serviceframe'],
        imageKeywords: ['military training', 'ruck march', 'uniform detail', 'field exercise', 'discipline', 'base gym'],
        subjects: [
            'this morning\'s field training block',
            'a solid ruck session before sunrise',
            'the discipline behind a simple uniform detail',
            'today\'s leadership note from the training ground',
            'a quiet moment after a demanding workout',
            'the routine that keeps long weeks structured',
        ],
        details: [
            'reminded me that consistency matters more than hype',
            'showed how preparation removes half the noise',
            'felt demanding in the best possible way',
            'turned into a good lesson in patience and focus',
            'made the basics feel worth respecting again',
            'put everything back into perspective',
        ],
        moods: [
            'Discipline is usually built in the quiet moments',
            'Respect the routine and the routine will carry you',
            'No shortcuts, just repetition',
            'Progress looks simple from the outside',
            'The boring work is still the real work',
        ],
        hashtags: ['militarylife', 'discipline', 'fieldtraining', 'leadership', 'service', 'trainingday', 'mindset', 'routine', 'fitness', 'preparation'],
        searches: ['field training routine', 'ruck training tips', 'military discipline quotes', 'leadership under pressure', 'uniform detail inspiration', 'service fitness routine'],
        comments: ['That mindset comes through clearly.', 'Strong detail and clean framing.', 'The discipline in this post stands out.', 'This is grounded and well observed.', 'Good reminder that consistency is the real flex.'],
        imageMin: 1,
        imageMax: 2,
    },
    'News': {
        usernames: ['morningbrief', 'signaldesk', 'contextwire', 'cityledger', 'headlinefield'],
        imageKeywords: ['newsroom', 'breaking news', 'journalism', 'city press', 'news desk', 'press briefing'],
        subjects: [
            'a morning briefing that needed more context',
            'today\'s city update in a cleaner format',
            'a headline that deserves the full timeline',
            'the data point hiding inside a noisy news cycle',
            'a quick public affairs summary from this afternoon',
            'a story where the details matter more than the reaction',
        ],
        details: [
            'felt much easier to understand once the numbers were laid out',
            'showed why the second paragraph usually matters most',
            'became more interesting the deeper I looked',
            'made the background information impossible to ignore',
            'proved that clarity is still a competitive advantage',
            'was worth slowing down for',
        ],
        moods: [
            'Context should travel with the headline',
            'A good summary saves everyone time',
            'Trying to keep the signal louder than the noise',
            'Facts first, hot takes later',
            'A clean timeline changes the whole read',
        ],
        hashtags: ['news', 'journalism', 'breakingnews', 'currentaffairs', 'newsupdate', 'press', 'factcheck', 'context', 'headlines', 'dailybrief'],
        searches: ['current affairs update', 'newsroom behind the scenes', 'daily news summary', 'headline context', 'press briefing photo', 'journalism desk setup'],
        comments: ['The framing here makes the story easier to follow.', 'Strong context without overexplaining.', 'This is exactly how news should be packaged.', 'Useful summary and clean visuals.', 'The timeline note is especially good.'],
        imageMin: 1,
        imageMax: 2,
    },
    'Funny Memes': {
        usernames: ['memeinterval', 'punchlinefeed', 'loopreaction', 'chaoticcaption', 'templatevibes'],
        imageKeywords: ['funny meme', 'internet humor', 'reaction face', 'comedy', 'viral meme', 'funny office'],
        subjects: [
            'the exact face I made after opening one more unread email',
            'that moment when the group chat suddenly wakes up at 2 AM',
            'my brain trying to multitask on a Monday morning',
            'the energy of pretending everything is under control',
            'the universal panic of clicking the wrong tab on a call',
            'how it feels when the snack break gets cancelled',
        ],
        details: [
            'was too accurate to leave in my camera roll',
            'felt painfully specific in the best way',
            'belongs in the weekly hall of fame',
            'managed to summarize the entire mood in one frame',
            'still makes me laugh every time I look at it',
            'did not need any extra explanation',
        ],
        moods: [
            'Tag the friend who would absolutely send this first',
            'Internet culture stays undefeated',
            'No notes, just chaos',
            'This one is for the overthinkers',
            'The timing was too good to ignore',
        ],
        hashtags: ['funnymemes', 'meme', 'relatable', 'internetculture', 'lol', 'comedygold', 'reaction', 'dailyhumor', 'memepage', 'chaoticenergy'],
        searches: ['funny meme template', 'reaction meme', 'relatable office meme', 'viral internet humor', 'chaotic funny post', 'group chat meme'],
        comments: ['This is painfully accurate.', 'Immediate save.', 'The caption made it even better.', 'This belongs in the group chat.', 'I laughed harder than I should have.'],
        imageMin: 1,
        imageMax: 1,
    },
    'Tech': {
        usernames: ['stacksignal', 'buildcircuit', 'codemode', 'shipfaster', 'siliconnotes'],
        imageKeywords: ['technology', 'developer desk', 'laptop code', 'software engineering', 'gadgets', 'ai workspace'],
        subjects: [
            'today\'s shipping session on the dev desk',
            'a hardware and software setup that finally feels balanced',
            'the small workflow upgrade I should have made months ago',
            'a neat debugging win from this afternoon',
            'the version of my desk that actually helps me focus',
            'a clean prototype sprint with fewer moving parts',
        ],
        details: [
            'cut more friction out of the process than I expected',
            'made the whole stack feel calmer to work in',
            'turned into a practical reminder that less clutter wins',
            'gave me the kind of momentum that keeps you shipping',
            'proved that smart defaults beat flashy extras',
            'ended up being more useful than impressive, which is perfect',
        ],
        moods: [
            'What tool has earned a permanent spot in your setup?',
            'Shipping beats fantasizing about shipping',
            'Clean systems make creative work easier',
            'A good desk is basically a productivity API',
            'This is the energy I want all week',
        ],
        hashtags: ['tech', 'developerlife', 'programming', 'buildinpublic', 'coding', 'setup', 'softwareengineering', 'productivity', 'gadgets', 'devdesk'],
        searches: ['best developer desk setup', 'clean coding workspace', 'software engineering setup', 'productivity gadgets', 'debugging workflow', 'ai workspace inspiration'],
        comments: ['This setup looks genuinely usable.', 'The workflow detail is the best part.', 'Practical and sharp.', 'You can tell this was built for real work.', 'Strong desk energy.'],
        imageMin: 1,
        imageMax: 3,
    },
    'Poetry': {
        usernames: ['stanzaafterdark', 'quietverses', 'inkandecho', 'linenotebook', 'midnightmeter'],
        imageKeywords: ['poetry book', 'typewriter poem', 'notebook writing', 'coffee and poetry', 'literary journal', 'poem page'],
        subjects: [
            'a small poem for the quieter part of the evening',
            'the line that stayed with me after a long day',
            'a notebook page that finally found its ending',
            'today\'s attempt at turning a feeling into language',
            'a soft draft written between errands and rain',
            'the kind of stanza that arrives slowly',
        ],
        details: [
            'felt gentler on the page than it did in my head',
            'kept asking to be rewritten until it breathed properly',
            'landed somewhere between memory and weather',
            'turned out simpler and truer than the first version',
            'needed more silence than punctuation',
            'felt like a good place to stop and listen',
        ],
        moods: [
            'Leaving this here for anyone who needed a softer sentence today',
            'Some pieces arrive quietly',
            'Language can hold more than it explains',
            'Reading this back still feels like standing near rain',
            'The short lines were enough this time',
        ],
        hashtags: ['poetry', 'poetsofinstagram', 'writingcommunity', 'poem', 'writersofinstagram', 'literary', 'verse', 'spokenword', 'notebook', 'englishpoetry'],
        searches: ['short english poetry', 'notebook poem aesthetic', 'literary journal inspiration', 'spoken word lines', 'coffee and poetry photo', 'soft poem caption'],
        comments: ['This line lands softly and stays there.', 'Beautiful restraint.', 'The rhythm here is excellent.', 'I would absolutely save this page.', 'Quiet and memorable.'],
        imageMin: 1,
        imageMax: 1,
    },
    'Graphic Design': {
        usernames: ['gridtheory', 'posterhabit', 'kernclub', 'layoutpulse', 'vectorweather'],
        imageKeywords: ['graphic design', 'poster design', 'brand identity', 'typography layout', 'creative studio', 'design grid'],
        subjects: [
            'a poster layout that finally clicked',
            'today\'s typography study with fewer distractions',
            'a branding draft built around stronger spacing',
            'the design pass where the hierarchy finally made sense',
            'a color system experiment from the studio',
            'the version of this composition I actually want to keep',
        ],
        details: [
            'proved that restraint can do most of the heavy lifting',
            'started working once the grid got cleaner',
            'felt much stronger after trimming the visual noise',
            'reminded me that contrast is a design language of its own',
            'earned its way out of the sketch folder',
            'looked better the moment I trusted the negative space',
        ],
        moods: [
            'Design gets easier when every element has a job',
            'The grid did most of the talking here',
            'Still obsessed with how good spacing can feel',
            'Process over polish, always',
            'This one taught me more than it showed off',
        ],
        hashtags: ['graphicdesign', 'designprocess', 'typography', 'layout', 'brandidentity', 'posterdesign', 'creativework', 'visualdesign', 'gridsystem', 'artdirection'],
        searches: ['poster design inspiration', 'typography layout ideas', 'graphic design grid', 'brand identity moodboard', 'creative studio process', 'color system design'],
        comments: ['The spacing here is doing real work.', 'Excellent hierarchy.', 'This is clean without feeling sterile.', 'The type choices are sharp.', 'Great example of controlled design.'],
        imageMin: 1,
        imageMax: 4,
    },
};

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG);
const GENERATED_USERNAME_PREFIXES = [
    'afterglow', 'atlas', 'beacon', 'blueprint', 'canvas', 'cobalt', 'common', 'cosmic',
    'daybreak', 'drift', 'echo', 'elevate', 'ember', 'field', 'focus', 'forward',
    'frame', 'glow', 'harbor', 'horizon', 'inside', 'lattice', 'lumen', 'metro',
    'modern', 'north', 'open', 'parallel', 'peak', 'quiet', 'rally', 'signal',
    'soft', 'steady', 'studio', 'summit', 'thread', 'vector', 'vivid', 'wild',
];
const GENERATED_USERNAME_SUFFIXES = [
    'archive', 'atlas', 'beam', 'blend', 'brief', 'cadence', 'circle', 'collective',
    'current', 'desk', 'draft', 'field', 'flow', 'frame', 'grid', 'habit',
    'journal', 'lab', 'line', 'loop', 'matrix', 'mode', 'notebook', 'notes',
    'orbit', 'pace', 'pattern', 'phase', 'post', 'press', 'relay', 'room',
    'signal', 'sketch', 'stack', 'studio', 'thread', 'tone', 'verse', 'wave',
];

function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6D2B79F5;
        let t = value;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rng = mulberry32(RANDOM_SEED);

function randomInt(min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(list) {
    return list[randomInt(0, list.length - 1)];
}

function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = randomInt(0, i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function uniquePick(list, count) {
    return shuffle(list).slice(0, Math.min(count, list.length));
}

function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function ensureSentence(value) {
    return /[.!?]$/.test(value) ? value : `${value}.`;
}

function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function now() {
    return new Date();
}

function dateDaysAgo(minDays, maxDays) {
    const end = now().getTime();
    const start = end - (maxDays * 24 * 60 * 60 * 1000);
    const latest = end - (minDays * 24 * 60 * 60 * 1000);
    return new Date(start + Math.floor(rng() * (latest - start + 1)));
}

function dateBetween(startDate, endDate) {
    const start = startDate.getTime();
    const end = endDate.getTime();
    if (end <= start) {
        return new Date(start);
    }
    return new Date(start + Math.floor(rng() * (end - start + 1)));
}

function normalizeQuery(value) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildCategoryPlan(totalPosts) {
    const categories = Object.keys(CATEGORY_CONFIG);
    const base = Math.floor(totalPosts / categories.length);
    let remainder = totalPosts % categories.length;

    return categories.map((category) => {
        const count = base + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        return { category, count };
    });
}

function buildCaption(category) {
    const config = CATEGORY_CONFIG[category];
    const hashtags = uniquePick(config.hashtags, randomInt(5, 8));
    const firstSentence = `${capitalize(pick(config.subjects))} ${pick(config.details)}`;
    const secondSentence = pick(config.moods);
    const hashtagString = hashtags.map((tag) => `#${tag}`).join(' ');

    return {
        caption: `${ensureSentence(firstSentence)} ${ensureSentence(secondSentence)} ${hashtagString}`,
        hashtags,
    };
}

function buildSeedAnalysisText(category, caption, hashtags) {
    const hashtagText = Array.isArray(hashtags) ? hashtags.map((tag) => `#${tag}`).join(' ') : '';
    return [category, caption, hashtagText].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function buildComment(category) {
    const config = CATEGORY_CONFIG[category];
    return pick(config.comments);
}

function buildImageUrl(category, postIndex, imageIndex) {
    const config = CATEGORY_CONFIG[category];
    const keywords = uniquePick(config.imageKeywords, Math.min(3, config.imageKeywords.length));
    const keywordQuery = encodeURIComponent(keywords.join(','));
    const seed = postIndex * 10 + imageIndex;

    if (IMAGE_PROVIDER === 'local-svg') {
        return createLocalSvgImage(category, keywords, seed);
    }

    if (IMAGE_PROVIDER === 'loremflickr') {
        return `https://loremflickr.com/1080/1350/${keywords.map(slugify).join(',')}?lock=${seed}`;
    }

    if (IMAGE_PROVIDER === 'picsum') {
        return `https://picsum.photos/seed/${slugify(category)}-${seed}/1080/1350`;
    }

    return `https://source.unsplash.com/featured/1080x1350/?${keywordQuery}&sig=${seed}`;
}

function buildImageUrls(category, postIndex) {
    const config = CATEGORY_CONFIG[category];
    const imageCount = randomInt(config.imageMin, config.imageMax);
    const urls = [];

    for (let i = 0; i < imageCount; i += 1) {
        urls.push(buildImageUrl(category, postIndex, i + 1));
    }

    return urls;
}

function uniqueValues(list) {
    return [...new Set(list)];
}

function formatCategoryList(categories) {
    if (categories.length === 0) return '';
    if (categories.length === 1) return categories[0];
    if (categories.length === 2) return `${categories[0]} and ${categories[1]}`;
    return `${categories.slice(0, -1).join(', ')}, and ${categories[categories.length - 1]}`;
}

function buildCategoryMix(primaryCategory, seedIndex, width = 5) {
    const primaryIndex = ALL_CATEGORIES.indexOf(primaryCategory);
    const rotatedCategories = Array.from({ length: ALL_CATEGORIES.length }, (_, offset) =>
        ALL_CATEGORIES[(primaryIndex + seedIndex + offset) % ALL_CATEGORIES.length]
    );

    return uniqueValues([
        primaryCategory,
        ...(CATEGORY_RELATIONS[primaryCategory] || []),
        ...rotatedCategories,
    ]).slice(0, width);
}

function buildSeededBio(postingCategories) {
    const readableCategories = postingCategories.slice(0, 4).map((category) => category.toLowerCase());
    return `English-only creator posting across ${formatCategoryList(readableCategories)} with realistic captions and visuals.`;
}

function buildLegacySeedUsers() {
    const rows = [];

    Object.entries(CATEGORY_CONFIG).forEach(([category, config], categoryIndex) => {
        config.usernames.forEach((usernameBase, index) => {
            const username = `${usernameBase}${index + 1}`;
            const email = `seed.${slugify(category)}.${index + 1}@${SEEDED_EMAIL_DOMAIN}`;
            const primaryCategory = ALL_CATEGORIES[(categoryIndex + index) % ALL_CATEGORIES.length];
            const postingCategories = buildCategoryMix(primaryCategory, categoryIndex + index, 5);

            rows.push({
                username,
                email,
                profilePic: `https://i.pravatar.cc/300?u=${encodeURIComponent(email)}`,
                bio: buildSeededBio(postingCategories),
                primaryCategory,
                interestCategories: postingCategories,
                postingCategories,
                isPrimaryDemoUser: index === 0,
            });
        });
    });

    return rows;
}

function buildGeneratedUsernames(requiredCount) {
    const handles = [];

    for (const prefix of GENERATED_USERNAME_PREFIXES) {
        for (const suffix of GENERATED_USERNAME_SUFFIXES) {
            if (prefix === suffix) {
                continue;
            }
            handles.push(`${prefix}${suffix}`);
            if (handles.length >= requiredCount) {
                return handles;
            }
        }
    }

    return handles;
}

function buildUserSeedRows() {
    const rows = buildLegacySeedUsers();
    if (rows.length >= TARGET_USER_COUNT) {
        return rows.slice(0, TARGET_USER_COUNT);
    }

    const baseCount = rows.length;
    const additionalCount = TARGET_USER_COUNT - rows.length;
    const generatedUsernames = buildGeneratedUsernames(additionalCount);

    generatedUsernames.forEach((usernameBase, index) => {
        const rowNumber = baseCount + index + 1;
        const primaryCategory = ALL_CATEGORIES[(rowNumber - 1) % ALL_CATEGORIES.length];
        const postingCategories = buildCategoryMix(primaryCategory, rowNumber, 5);
        const ordinal = String(rowNumber).padStart(3, '0');
        const username = `${usernameBase}${ordinal}`;
        const email = `seed.user.${ordinal}@${SEEDED_EMAIL_DOMAIN}`;

        rows.push({
            username,
            email,
            profilePic: `https://i.pravatar.cc/300?u=${encodeURIComponent(email)}`,
            bio: buildSeededBio(postingCategories),
            primaryCategory,
            interestCategories: postingCategories,
            postingCategories,
            isPrimaryDemoUser: false,
        });
    });

    return rows;
}

function getProtectedSeedUsers(users) {
    if (!PROTECT_PRIMARY_DEMO_USERS) {
        return [];
    }
    return users.filter((user) => Boolean(user.isPrimaryDemoUser));
}

function getBackgroundSeedUsers(users) {
    const protectedIds = new Set(getProtectedSeedUsers(users).map((user) => user.id));
    return users.filter((user) => !protectedIds.has(user.id));
}

function filterPostsByAuthors(postsByCategory, allowedUsers) {
    const allowedUserIds = new Set(allowedUsers.map((user) => user.id));
    const filtered = {};

    Object.entries(postsByCategory).forEach(([category, posts]) => {
        filtered[category] = posts.filter((post) => allowedUserIds.has(post.userId));
    });

    return filtered;
}

function pickWeightedUniquePosts(weightedPool, desiredCount) {
    const seen = new Set();
    const selected = [];

    for (const post of shuffle(weightedPool)) {
        if (seen.has(post.id)) {
            continue;
        }
        seen.add(post.id);
        selected.push(post);
        if (selected.length >= desiredCount) {
            return selected;
        }
    }

    return selected;
}

function buildWeightedCandidatePool(postsByCategory, user) {
    const pool = [];

    user.interestCategories.forEach((category, index) => {
        const categoryPosts = postsByCategory[category] || [];
        const weight = index === 0 ? 5 : index === 1 ? 3 : 2;

        categoryPosts
            .filter((post) => post.userId !== user.id)
            .forEach((post) => {
                for (let i = 0; i < weight; i += 1) {
                    pool.push(post);
                }
            });
    });

    return pool;
}

function buildFollowTargets(users, currentUser) {
    const similar = users.filter((user) =>
        user.id !== currentUser.id &&
        currentUser.interestCategories.some((category) => user.interestCategories.includes(category))
    );

    const others = users.filter((user) =>
        user.id !== currentUser.id &&
        !currentUser.interestCategories.some((category) => user.interestCategories.includes(category))
    );

    return [
        ...uniquePick(similar, randomInt(6, 9)),
        ...uniquePick(others, randomInt(1, 3)),
    ];
}

function buildAuthorTargets(users, totalPosts) {
    const base = Math.floor(totalPosts / users.length);
    let remainder = totalPosts % users.length;
    const targets = new Map();

    shuffle(users).forEach((user) => {
        const target = base + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        targets.set(user.id, target);
    });

    return targets;
}

function initializeAuthorAssignment(users, totalPosts) {
    const targets = buildAuthorTargets(users, totalPosts);
    const state = new Map();

    users.forEach((user, index) => {
        state.set(user.id, {
            order: index,
            totalPosts: 0,
            categoriesUsed: new Set(),
            categoryCounts: new Map(),
            recentCategories: [],
        });
    });

    return { targets, state };
}

function chooseAuthorForCategory(users, category, assignment, postIndex) {
    const eligibleUsers = users.filter((user) => (user.postingCategories || user.interestCategories || []).includes(category));
    const candidates = eligibleUsers.length > 0 ? eligibleUsers : users;
    let selectedUser = candidates[0];
    let selectedScore = Number.POSITIVE_INFINITY;

    for (const user of candidates) {
        const authorState = assignment.state.get(user.id);
        const targetPosts = assignment.targets.get(user.id) || 1;
        const sameCategoryCount = authorState.categoryCounts.get(category) || 0;
        const hasCategory = authorState.categoriesUsed.has(category);
        const needsVariety = authorState.categoriesUsed.size < Math.min(3, targetPosts);
        const overTargetBy = Math.max(0, authorState.totalPosts - targetPosts);
        const recentPenalty = authorState.recentCategories.includes(category) ? 1.15 : 0;
        const utilizationPenalty = authorState.totalPosts / Math.max(1, targetPosts);
        const categoryRepeatPenalty = sameCategoryCount * 2.6;
        const overTargetPenalty = overTargetBy * 3.2;
        const varietyBoost = !hasCategory ? (needsVariety ? -2.4 : -0.55) : 0;
        const underTargetBoost = authorState.totalPosts < targetPosts ? -0.75 : 0;
        const rotationBias = (((postIndex * 31) + (authorState.order * 17)) % 19) / 100;
        const score = utilizationPenalty + categoryRepeatPenalty + overTargetPenalty + recentPenalty + varietyBoost + underTargetBoost + rotationBias;

        if (score < selectedScore) {
            selectedScore = score;
            selectedUser = user;
        }
    }

    return selectedUser;
}

function markAuthorAssignment(assignment, userId, category) {
    const authorState = assignment.state.get(userId);
    authorState.totalPosts += 1;
    authorState.categoriesUsed.add(category);
    authorState.categoryCounts.set(category, (authorState.categoryCounts.get(category) || 0) + 1);
    authorState.recentCategories = [...authorState.recentCategories.slice(-1), category];
}

function ensureSeededUploadsDir() {
    if (!fs.existsSync(SEEDED_UPLOADS_DIR)) {
        fs.mkdirSync(SEEDED_UPLOADS_DIR, { recursive: true });
    }
}

function cleanupSeededUploads() {
    ensureSeededUploadsDir();
    const entries = fs.readdirSync(SEEDED_UPLOADS_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('seed-') && entry.name.endsWith('.svg')) {
            fs.unlinkSync(path.join(SEEDED_UPLOADS_DIR, entry.name));
        }
    }
}

function escapeXml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function categoryPalette(category) {
    const palettes = {
        'Gaming': ['#0f172a', '#2563eb', '#22d3ee'],
        'Army/Military': ['#1f2937', '#4b5563', '#84cc16'],
        'News': ['#111827', '#334155', '#f97316'],
        'Funny Memes': ['#7c2d12', '#f59e0b', '#facc15'],
        'Tech': ['#0f172a', '#0f766e', '#14b8a6'],
        'Poetry': ['#4c1d95', '#7c3aed', '#f9a8d4'],
        'Graphic Design': ['#111827', '#db2777', '#f97316'],
    };

    return palettes[category] || ['#1f2937', '#475569', '#94a3b8'];
}

function createLocalSvgImage(category, keywords, seed) {
    ensureSeededUploadsDir();
    const [base, accent, glow] = categoryPalette(category);
    const filename = `seed-${slugify(category)}-${seed}.svg`;
    const absolutePath = path.join(SEEDED_UPLOADS_DIR, filename);

    if (!fs.existsSync(absolutePath)) {
        const lines = [
            category,
            keywords[0] || '',
            keywords[1] || '',
        ].filter(Boolean);
        const circles = Array.from({ length: 5 }, (_, index) => {
            const x = 120 + ((seed * (index + 3) * 37) % 840);
            const y = 140 + ((seed * (index + 5) * 29) % 980);
            const radius = 60 + ((seed * (index + 7) * 11) % 120);
            const opacity = (0.08 + (index * 0.03)).toFixed(2);
            return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${glow}" opacity="${opacity}" />`;
        }).join('\n        ');

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${base}" />
      <stop offset="55%" stop-color="${accent}" />
      <stop offset="100%" stop-color="${glow}" />
    </linearGradient>
  </defs>
  <rect width="1080" height="1350" fill="url(#bg)" />
  ${circles}
  <rect x="72" y="72" width="936" height="1206" rx="40" fill="rgba(15,23,42,0.18)" stroke="rgba(255,255,255,0.22)" />
  <text x="108" y="180" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="40" letter-spacing="8">INSTACLONE</text>
  <text x="108" y="340" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="108">${escapeXml(category)}</text>
  <text x="108" y="430" fill="rgba(255,255,255,0.88)" font-family="Arial, Helvetica, sans-serif" font-size="34">${escapeXml(lines.join(' • '))}</text>
  <text x="108" y="1160" fill="rgba(255,255,255,0.92)" font-family="Arial, Helvetica, sans-serif" font-size="42">Seed ${seed}</text>
  <text x="108" y="1218" fill="rgba(255,255,255,0.74)" font-family="Arial, Helvetica, sans-serif" font-size="28">Locally generated placeholder image for UI testing</text>
</svg>`;

        fs.writeFileSync(absolutePath, svg, 'utf8');
    }

    return `http://localhost:8080/uploads/seeded/${filename}`;
}

async function applySchema(client) {
    const schemaPath = path.join(__dirname, 'instagram_recommendation_schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schemaSql);
}

async function deletePreviousSeedData(client) {
    cleanupSeededUploads();
    await client.query(
        `DELETE FROM users WHERE email LIKE $1`,
        [`seed.%@${SEEDED_EMAIL_DOMAIN}`]
    );
}

async function insertSeedUsers(client) {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const userRows = buildUserSeedRows();
    const insertedUsers = [];

    for (const row of userRows) {
        const result = await client.query(
            `INSERT INTO users (username, email, password, profile_pic, bio, is_private, last_active, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
                row.username,
                row.email,
                passwordHash,
                row.profilePic,
                row.bio,
                false,
                dateDaysAgo(0, 20),
                dateDaysAgo(45, 160),
            ]
        );

        insertedUsers.push({
            ...row,
            id: result.rows[0].id,
        });
    }

    return insertedUsers;
}

async function insertFollows(client, users) {
    let followCount = 0;

    for (const user of users) {
        const targets = buildFollowTargets(users, user);

        for (const target of targets) {
            if (target.id === user.id) {
                continue;
            }
            const createdAt = dateDaysAgo(10, 160);

            await client.query(
                `INSERT INTO follows (follower_id, following_id, status, accepted_at, created_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (follower_id, following_id) DO NOTHING`,
                [user.id, target.id, 'accepted', createdAt, createdAt]
            );
            followCount += 1;
        }
    }

    return followCount;
}

async function insertPosts(client, users) {
    const posts = [];
    const postsByCategory = {};
    const assignment = initializeAuthorAssignment(users, TOTAL_POSTS);

    const plan = buildCategoryPlan(TOTAL_POSTS);
    let postIndex = 0;

    for (const item of plan) {
        for (let i = 0; i < item.count; i += 1) {
            postIndex += 1;
            const author = chooseAuthorForCategory(users, item.category, assignment, postIndex);
            markAuthorAssignment(assignment, author.id, item.category);
            const { caption, hashtags } = buildCaption(item.category);
            const imageUrls = buildImageUrls(item.category, postIndex);
            const createdAt = dateDaysAgo(0, 180);
            const analysisText = buildSeedAnalysisText(item.category, caption, hashtags);
            const embedding = buildLocalEmbedding(analysisText);
            const metadata = {
                seeded: true,
                provider: IMAGE_PROVIDER,
                image_keywords: uniquePick(CATEGORY_CONFIG[item.category].imageKeywords, 3),
                author_category_mix: author.postingCategories,
                analysis_source: 'seed',
            };

            const postResult = await client.query(
                `INSERT INTO posts (
                    user_id,
                    category,
                    caption,
                    hashtags,
                    language_code,
                    metadata,
                    analysis_text,
                    analysis_status,
                    analysis_updated_at,
                    embedding,
                    created_at,
                    updated_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
                 RETURNING id`,
                [
                    author.id,
                    item.category,
                    caption,
                    hashtags,
                    'en',
                    JSON.stringify(metadata),
                    analysisText,
                    'ready',
                    createdAt,
                    embedding,
                    createdAt,
                    createdAt,
                ]
            );

            const post = {
                id: postResult.rows[0].id,
                userId: author.id,
                category: item.category,
                caption,
                hashtags,
                createdAt,
            };

            posts.push(post);
            if (!postsByCategory[item.category]) {
                postsByCategory[item.category] = [];
            }
            postsByCategory[item.category].push(post);

            for (let imageOrder = 0; imageOrder < imageUrls.length; imageOrder += 1) {
                await client.query(
                    `INSERT INTO post_images (post_id, image_url, sort_order, created_at)
                     VALUES ($1, $2, $3, $4)`,
                    [post.id, imageUrls[imageOrder], imageOrder, createdAt]
                );
            }
        }
    }

    return { posts, postsByCategory };
}

async function insertLikes(client, users, postsByCategory) {
    let likeCount = 0;

    for (const user of users) {
        const candidatePool = buildWeightedCandidatePool(postsByCategory, user);
        const selectedPosts = pickWeightedUniquePosts(candidatePool, randomInt(50, 75));

        for (const post of selectedPosts) {
            await client.query(
                `INSERT INTO likes (post_id, user_id, created_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (post_id, user_id) DO NOTHING`,
                [post.id, user.id, dateBetween(post.createdAt, now())]
            );
            likeCount += 1;
        }
    }

    return likeCount;
}

async function insertSaves(client, users, postsByCategory) {
    let saveCount = 0;

    for (const user of users) {
        const candidatePool = buildWeightedCandidatePool(postsByCategory, user);
        const selectedPosts = pickWeightedUniquePosts(candidatePool, randomInt(12, 22));

        for (const post of selectedPosts) {
            await client.query(
                `INSERT INTO saved_posts (post_id, user_id, created_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (post_id, user_id) DO NOTHING`,
                [post.id, user.id, dateBetween(post.createdAt, now())]
            );
            saveCount += 1;
        }
    }

    return saveCount;
}

async function insertComments(client, users, postsByCategory) {
    let commentCount = 0;

    for (const user of users) {
        const candidatePool = buildWeightedCandidatePool(postsByCategory, user);
        const selectedPosts = pickWeightedUniquePosts(candidatePool, randomInt(8, 16));

        for (const post of selectedPosts) {
            await client.query(
                `INSERT INTO comments (post_id, user_id, text, is_pinned, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    post.id,
                    user.id,
                    buildComment(post.category),
                    false,
                    dateBetween(post.createdAt, now()),
                    dateBetween(post.createdAt, now()),
                ]
            );
            commentCount += 1;
        }
    }

    return commentCount;
}

async function insertSearches(client, users, postsByCategory) {
    let searchCount = 0;

    for (const user of users) {
        const searchRuns = randomInt(14, 24);

        for (let i = 0; i < searchRuns; i += 1) {
            const category = user.interestCategories[i % user.interestCategories.length];
            const config = CATEGORY_CONFIG[category];
            const baseQuery = pick(config.searches);
            const queryText = rng() > 0.55
                ? `${baseQuery} ${pick(config.hashtags)}`
                : baseQuery;
            const resultPosts = uniquePick(
                (postsByCategory[category] || []).filter((post) => post.userId !== user.id),
                randomInt(4, 9)
            );
            const clickedPost = resultPosts.length > 0 && rng() > 0.25
                ? pick(resultPosts)
                : null;
            const createdAt = dateDaysAgo(0, 90);

            await client.query(
                `INSERT INTO user_searches (
                    user_id,
                    query_text,
                    normalized_query,
                    matched_category,
                    matched_hashtags,
                    results_count,
                    result_post_ids,
                    clicked_post_id,
                    created_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    user.id,
                    queryText,
                    normalizeQuery(queryText),
                    category,
                    uniquePick(config.hashtags, randomInt(2, 4)),
                    resultPosts.length + randomInt(0, 12),
                    resultPosts.map((post) => post.id),
                    clickedPost ? clickedPost.id : null,
                    createdAt,
                ]
            );
            searchCount += 1;
        }
    }

    return searchCount;
}

async function main() {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        if (!seedOnly) {
            console.log('Applying recommendation schema...');
            await applySchema(client);
        }

        if (schemaOnly) {
            console.log('Schema applied successfully.');
            return;
        }

        console.log('Seeding Instagram recommendation data...');
        await client.query('BEGIN');
        inTransaction = true;
        await deletePreviousSeedData(client);

        const users = await insertSeedUsers(client);
        const protectedUsers = getProtectedSeedUsers(users);
        const interactionUsers = SEED_WITH_INTERACTIONS ? getBackgroundSeedUsers(users) : [];
        let followCount = 0;
        const { posts, postsByCategory } = await insertPosts(client, users);
        const interactionPostsByCategory = filterPostsByAuthors(postsByCategory, interactionUsers);
        let likeCount = 0;
        let saveCount = 0;
        let commentCount = 0;
        let searchCount = 0;

        if (SEED_WITH_INTERACTIONS) {
            followCount = await insertFollows(client, interactionUsers);
            likeCount = await insertLikes(client, interactionUsers, interactionPostsByCategory);
            saveCount = await insertSaves(client, interactionUsers, interactionPostsByCategory);
            commentCount = await insertComments(client, interactionUsers, interactionPostsByCategory);
            searchCount = await insertSearches(client, interactionUsers, interactionPostsByCategory);
        }

        await client.query('COMMIT');
        inTransaction = false;

        const categorySummary = buildCategoryPlan(TOTAL_POSTS)
            .map((item) => `${item.category}: ${item.count}`)
            .join(', ');

        console.log('Seed complete.');
        console.log(`Users: ${users.length}`);
        console.log(`Posts: ${posts.length}`);
        console.log(`Follows: ${followCount}`);
        console.log(`Likes: ${likeCount}`);
        console.log(`Saves: ${saveCount}`);
        console.log(`Comments: ${commentCount}`);
        console.log(`Searches: ${searchCount}`);
        console.log(`Category distribution: ${categorySummary}`);
        console.log(`Image provider: ${IMAGE_PROVIDER}`);
        console.log(`Seeded interactions: ${SEED_WITH_INTERACTIONS ? 'enabled' : 'disabled'}`);
        console.log(`Protected demo users: ${protectedUsers.length}`);
        console.log(`Seeded user password: ${DEFAULT_PASSWORD}`);
    } catch (error) {
        if (inTransaction) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Rollback failed:', rollbackError.message);
            }
        }
        console.error('Seeding failed:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
