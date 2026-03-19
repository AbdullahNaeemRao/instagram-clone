const BACKEND_URL = 'http://127.0.0.1:8080';

function buildHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function ensureJson(response, method, path) {
  if (!response.ok()) {
    throw new Error(`${method} ${path} failed with ${response.status()} ${response.statusText()}`);
  }
  return response.json();
}

async function apiGet(request, path, token) {
  const response = await request.get(`${BACKEND_URL}${path}`, {
    headers: buildHeaders(token),
  });
  return ensureJson(response, 'GET', path);
}

async function apiPost(request, path, token, data = {}) {
  const response = await request.post(`${BACKEND_URL}${path}`, {
    headers: buildHeaders(token),
    data,
  });
  return ensureJson(response, 'POST', path);
}

async function apiPut(request, path, token, data = {}) {
  const response = await request.put(`${BACKEND_URL}${path}`, {
    headers: buildHeaders(token),
    data,
  });
  return ensureJson(response, 'PUT', path);
}

async function apiDelete(request, path, token) {
  const response = await request.delete(`${BACKEND_URL}${path}`, {
    headers: buildHeaders(token),
  });
  return ensureJson(response, 'DELETE', path);
}

function countCategory(posts, category) {
  return posts.filter((post) => post.category === category).length;
}

async function countCategoryAcrossSeeds(request, token, endpoint, category, seeds, limit = 24) {
  let total = 0;
  for (const seed of seeds) {
    const posts = await apiGet(request, `${endpoint}?limit=${limit}&offset=0&seed=${seed}`, token);
    total += countCategory(posts, category);
  }
  return total;
}

async function distinctCategoryCount(request, token, endpoint, seed, limit = 24) {
  const posts = await apiGet(request, `${endpoint}?limit=${limit}&offset=0&seed=${seed}`, token);
  return new Set(posts.map((post) => post.category).filter(Boolean)).size;
}

module.exports = {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  countCategoryAcrossSeeds,
  distinctCategoryCount,
};
