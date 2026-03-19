const { test, expect } = require('@playwright/test');
const { accounts, OCR_FIXTURE_IMAGE } = require('./helpers/accounts');
const { login, clickNav } = require('./helpers/session');
const { query, waitFor } = require('./helpers/db');

test('user can save a post and manage their own uploaded post end-to-end', async ({ page }) => {
  test.setTimeout(180000);

  await login(page, accounts.gaming);

  const beforeResult = await query(
    `SELECT COALESCE(MAX(p.id), 0) AS max_id
     FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE u.email = $1`,
    [accounts.gaming.email]
  );
  const previousMaxId = Number(beforeResult.rows[0].max_id || 0);

  const savedCandidate = page.getByTestId('feed-post-card').first();
  const savedPostId = await savedCandidate.getAttribute('data-post-id');
  await savedCandidate.getByTestId('feed-post-save').click();

  await clickNav(page, 'create');
  await expect(page.getByTestId('upload-modal')).toBeVisible();

  const originalCaption = 'Playwright upload caption for content management';
  await page.getByTestId('upload-file-input').setInputFiles(OCR_FIXTURE_IMAGE);
  await page.getByTestId('upload-caption-input').fill(originalCaption);
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-modal')).toHaveCount(0);

  const createdPost = await waitFor(async () => {
    const result = await query(
      `SELECT p.id, p.caption
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE u.email = $1
         AND p.id > $2
       ORDER BY p.id DESC
       LIMIT 1`,
      [accounts.gaming.email, previousMaxId]
    );

    return result.rows[0] || null;
  }, { timeout: 60000, interval: 1500, message: 'newly uploaded post' });

  await clickNav(page, 'profile');
  await expect(page).toHaveURL(new RegExp(`/u/${accounts.gaming.username}$`));

  const createdTile = page.locator(`[data-testid="profile-post-tile"][data-post-id="${createdPost.id}"]`);
  await expect(createdTile).toBeVisible();
  await createdTile.click();

  await expect(page.getByTestId('post-modal')).toBeVisible();
  await page.getByTestId('post-modal-edit').click();

  const updatedCaption = `${originalCaption} updated`;
  await page.getByTestId('post-modal-edit-caption').fill(updatedCaption);
  await page.getByTestId('post-modal-edit-save').click();
  await expect(page.getByText(updatedCaption, { exact: false })).toBeVisible();

  await waitFor(async () => {
    const result = await query('SELECT caption FROM posts WHERE id = $1', [createdPost.id]);
    return result.rows[0]?.caption === updatedCaption ? true : null;
  }, { timeout: 30000, interval: 1000, message: 'updated post caption' });

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('post-modal-delete').click();

  await waitFor(async () => {
    const result = await query('SELECT 1 FROM posts WHERE id = $1', [createdPost.id]);
    return result.rows.length === 0 ? true : null;
  }, { timeout: 30000, interval: 1000, message: 'deleted uploaded post' });

  await expect(page.locator(`[data-testid="profile-post-tile"][data-post-id="${createdPost.id}"]`)).toHaveCount(0);

  await page.getByTestId('profile-tab-saved').click();
  await expect(page.locator(`[data-testid="profile-saved-tile"][data-post-id="${savedPostId}"]`)).toBeVisible();
});
