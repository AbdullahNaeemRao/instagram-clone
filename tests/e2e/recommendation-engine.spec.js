const { test, expect } = require('@playwright/test');
const { accounts } = require('./helpers/accounts');
const { login, getToken, clickNav } = require('./helpers/session');
const { query, waitFor } = require('./helpers/db');
const { apiPost, countCategoryAcrossSeeds, distinctCategoryCount } = require('./helpers/api');

async function collectIds(page, testId, limit = 6) {
  await expect(page.getByTestId(testId).first()).toBeVisible();
  return page.getByTestId(testId).evaluateAll(
    (nodes, requestedLimit) => nodes.slice(0, requestedLimit).map((node) => node.getAttribute('data-post-id')),
    limit
  );
}

async function refreshUntilChanged(page, refreshLocator, testId) {
  const originalIds = await collectIds(page, testId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await refreshLocator.click();
    await page.waitForTimeout(800);
    const nextIds = await collectIds(page, testId);
    if (JSON.stringify(nextIds) !== JSON.stringify(originalIds)) {
      return { originalIds, nextIds };
    }
  }

  throw new Error(`Refreshing ${testId} did not rotate the visible posts.`);
}

async function findTileByCategory(page, category) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const tile = page.locator(`[data-testid="explore-post-tile"][data-post-category="${category}"]`).first();
    if (await tile.count()) {
      return tile;
    }
    await page.getByTestId('explore-refresh').click();
    await page.waitForTimeout(800);
  }

  throw new Error(`Could not find an explore tile for category ${category}`);
}

test('home and explore refresh rotate the visible posts', async ({ page }) => {
  await login(page, accounts.news);

  const homeChange = await refreshUntilChanged(page, page.getByTestId('home-feed-refresh'), 'feed-post-card');
  expect(homeChange.nextIds).not.toEqual(homeChange.originalIds);

  await clickNav(page, 'explore');
  const exploreChange = await refreshUntilChanged(page, page.getByTestId('explore-refresh'), 'explore-post-tile');
  expect(exploreChange.nextIds).not.toEqual(exploreChange.originalIds);
});

test('positive recommendation signals increase the target category without collapsing diversity', async ({ page, request }) => {
  await login(page, accounts.news);
  const token = await getToken(page);

  const baselinePoetry = await countCategoryAcrossSeeds(request, token, '/api/posts', 'Poetry', [101, 102, 103, 104]);

  await clickNav(page, 'explore');
  const poetryTile = await findTileByCategory(page, 'Poetry');
  const poetryPostId = await poetryTile.getAttribute('data-post-id');
  await poetryTile.click();
  await expect(page.getByTestId('post-modal')).toBeVisible();
  await page.getByTestId('post-modal-interested').click();

  await apiPost(request, `/api/posts/${poetryPostId}/like`, token);
  await apiPost(request, `/api/posts/${poetryPostId}/comments`, token, { text: 'Playwright recommendation boost' });

  await waitFor(async () => {
    const result = await query(
      'SELECT interest_embedding FROM users WHERE email = $1',
      [accounts.news.email]
    );
    return result.rows[0]?.interest_embedding ? result.rows[0].interest_embedding : null;
  }, { message: 'user interest embedding after positive signals' });

  const boostedPoetry = await countCategoryAcrossSeeds(request, token, '/api/posts', 'Poetry', [111, 112, 113, 114]);
  expect(boostedPoetry).toBeGreaterThan(baselinePoetry);

  const distinctCategories = await distinctCategoryCount(request, token, '/api/posts', 115);
  expect(distinctCategories).toBeGreaterThanOrEqual(4);
});
