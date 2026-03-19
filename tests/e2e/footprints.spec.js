const { test, expect } = require('@playwright/test');
const { accounts } = require('./helpers/accounts');
const { login, clickNav } = require('./helpers/session');
const { query, waitFor } = require('./helpers/db');

test('profile activity shows liked and commented posts and allows removing those footprints', async ({ page }) => {
  test.setTimeout(180000);

  const userResult = await query('SELECT id FROM users WHERE email = $1', [accounts.news.email]);
  const userId = Number(userResult.rows[0].id);

  await login(page, accounts.news);

  const targetPost = page.getByTestId('feed-post-card').first();
  const postId = Number(await targetPost.getAttribute('data-post-id'));

  await targetPost.getByTestId('feed-post-like').click();
  await waitFor(async () => {
    const result = await query('SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    return result.rows.length > 0 ? true : null;
  }, { timeout: 30000, interval: 1000, message: 'liked post footprint' });

  const commentText = `Playwright footprint comment ${Date.now()}`;
  await targetPost.getByTestId('feed-post-comments-toggle').click();
  await targetPost.getByTestId('feed-post-comment-input').fill(commentText);
  await targetPost.getByTestId('feed-post-comment-submit').click();

  const comment = await waitFor(async () => {
    const result = await query(
      `SELECT c.id
       FROM comments c
       WHERE c.post_id = $1
         AND c.user_id = $2
         AND c.text = $3
       ORDER BY c.id DESC
       LIMIT 1`,
      [postId, userId, commentText]
    );
    return result.rows[0] || null;
  }, { timeout: 30000, interval: 1000, message: 'commented post footprint' });

  await clickNav(page, 'profile');
  await expect(page).toHaveURL(new RegExp(`/u/${accounts.news.username}$`));

  await page.getByTestId('profile-tab-liked').click();
  const likedCard = page.locator(`[data-testid="profile-liked-card"][data-post-id="${postId}"]`);
  await expect(likedCard).toBeVisible();
  await likedCard.getByTestId('profile-liked-open').click();
  await expect(page.getByTestId('post-modal')).toBeVisible();
  await page.getByTestId('post-modal-close').click();
  await expect(page.getByTestId('post-modal')).toHaveCount(0);
  await likedCard.getByTestId('profile-liked-remove').click();
  await expect(likedCard).toHaveCount(0);

  await waitFor(async () => {
    const result = await query('SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    return result.rows.length === 0 ? true : null;
  }, { timeout: 30000, interval: 1000, message: 'removed liked footprint' });

  await page.getByTestId('profile-tab-commented').click();
  const commentedCard = page.locator(`[data-testid="profile-commented-card"][data-post-id="${postId}"]`);
  await expect(commentedCard).toBeVisible();
  await commentedCard.getByTestId('profile-commented-open').click();
  await expect(page.getByTestId('post-modal')).toBeVisible();
  await page.getByTestId('post-modal-close').click();
  await expect(page.getByTestId('post-modal')).toHaveCount(0);

  const commentRow = commentedCard.locator(`[data-testid="profile-commented-comment"][data-comment-id="${comment.id}"]`);
  await expect(commentRow).toContainText(commentText);
  page.once('dialog', (dialog) => dialog.accept());
  await commentRow.getByTestId('profile-commented-delete-comment').click();
  await expect(commentedCard).toHaveCount(0);

  await waitFor(async () => {
    const result = await query('SELECT 1 FROM comments WHERE id = $1', [comment.id]);
    return result.rows.length === 0 ? true : null;
  }, { timeout: 30000, interval: 1000, message: 'removed comment footprint' });
});
