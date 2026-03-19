const path = require('path');

const DEFAULT_PASSWORD = 'SeedDemo123!';

const accounts = {
  gaming: {
    email: 'seed.gaming.1@seedgram.local',
    username: 'pixelraider1',
    password: DEFAULT_PASSWORD,
  },
  tech: {
    email: 'seed.tech.1@seedgram.local',
    username: 'stacksignal1',
    password: DEFAULT_PASSWORD,
  },
  news: {
    email: 'seed.news.1@seedgram.local',
    username: 'morningbrief1',
    password: DEFAULT_PASSWORD,
  },
  army: {
    email: 'seed.army-military.1@seedgram.local',
    username: 'ruckjournal1',
    password: DEFAULT_PASSWORD,
  },
  poetry: {
    email: 'seed.poetry.1@seedgram.local',
    username: 'stanzaafterdark1',
    password: DEFAULT_PASSWORD,
  },
};

const OCR_FIXTURE_IMAGE = path.resolve(__dirname, '..', '..', '..', 'uploads', '1770396732887-Screenshot-2025-11-22-000228.png');

module.exports = {
  DEFAULT_PASSWORD,
  accounts,
  OCR_FIXTURE_IMAGE,
};
