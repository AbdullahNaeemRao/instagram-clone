const { test, expect } = require('@playwright/test');
const { accounts, OCR_FIXTURE_IMAGE } = require('./helpers/accounts');
const { login, clickNav, getToken } = require('./helpers/session');
const { query, waitFor } = require('./helpers/db');
const { apiGet, apiPost, apiPut } = require('./helpers/api');

test('threaded comment replies and comment likes work end-to-end', async ({ page }) => {
  await login(page, accounts.tech);

  const firstPost = page.getByTestId('feed-post-card').first();
  await firstPost.getByTestId('feed-post-comments-toggle').click();

  const rootCommentText = 'Playwright threaded root comment';
  await firstPost.getByTestId('feed-post-comment-input').fill(rootCommentText);
  await firstPost.getByTestId('feed-post-comment-submit').click();

  const rootComment = firstPost.getByTestId('comment-item').filter({ hasText: rootCommentText }).first();
  await expect(rootComment).toBeVisible();
  const rootCommentId = await rootComment.getAttribute('data-comment-id');

  await rootComment.getByTestId('comment-reply-button').click();
  await expect(firstPost.getByTestId('feed-post-comment-reply-banner')).toBeVisible();

  const replyCommentText = 'Playwright threaded reply comment';
  await firstPost.getByTestId('feed-post-comment-input').fill(replyCommentText);
  await firstPost.getByTestId('feed-post-comment-submit').click();

  const replyComment = firstPost.locator(`[data-testid="comment-item"][data-parent-comment-id="${rootCommentId}"]`).filter({ hasText: replyCommentText }).first();
  await expect(replyComment).toBeVisible();

  await rootComment.getByTestId('comment-like-button').click();
  await expect(rootComment).toContainText('1 likes');
});

test('accepted followers can view, like, and comment on private stories', async ({ browser, request }) => {
  test.setTimeout(240000);

  const ownerContext = await browser.newContext();
  const followerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const followerPage = await followerContext.newPage();

  let ownerToken = null;
  let followerToken = null;
  let storyId = null;

  try {
    await login(ownerPage, accounts.army);
    ownerToken = await getToken(ownerPage);
    await clickNav(ownerPage, 'profile');
    await ownerPage.getByTestId('profile-settings-button').click();
    await ownerPage.getByTestId('settings-private-toggle').click();
    await ownerPage.getByRole('button', { name: 'Done' }).click();

    await clickNav(ownerPage, 'home');
    await ownerPage.getByTestId('story-bubble-own').click();
    await expect(ownerPage.getByTestId('story-upload-modal')).toBeVisible();
    await ownerPage.getByTestId('story-upload-input').setInputFiles(OCR_FIXTURE_IMAGE);
    await ownerPage.getByTestId('story-upload-submit').click();
    await expect(ownerPage.getByTestId('story-upload-modal')).toHaveCount(0);

    storyId = await waitFor(async () => {
      const result = await query(
        `SELECT s.id
         FROM stories s
         JOIN users u ON u.id = s.user_id
         WHERE u.email = $1
         ORDER BY s.id DESC
         LIMIT 1`,
        [accounts.army.email]
      );
      return result.rows[0]?.id || null;
    }, { timeout: 30000, interval: 1000, message: 'private owner story' });

    await login(followerPage, accounts.tech);
    followerToken = await getToken(followerPage);
    await clickNav(followerPage, 'search');
    await followerPage.getByTestId('search-input').fill(accounts.army.username);
    const resultRow = followerPage.locator(`[data-testid="search-result-row"][data-username="${accounts.army.username}"]`);
    await expect(resultRow).toBeVisible();
    await resultRow.click();
    await followerPage.getByTestId('profile-follow-button').click();
    await expect(followerPage.getByTestId('profile-follow-button')).toContainText('Requested');

    await clickNav(ownerPage, 'notifications');
    const requestRow = ownerPage.locator(`[data-testid="follow-request-row"][data-username="${accounts.tech.username}"]`);
    await expect(requestRow).toBeVisible();
    await requestRow.getByTestId('follow-request-confirm').click();
    await expect(requestRow).toHaveCount(0);

    await followerPage.goto('/');
    const ownerStoryBubble = followerPage.locator(`[data-testid="story-bubble"][data-username="${accounts.army.username}"]`);
    await expect(ownerStoryBubble).toBeVisible();
    await ownerStoryBubble.click();

    await expect(followerPage.getByTestId('story-viewer')).toBeVisible();
    await followerPage.getByTestId('story-like-button').click();
    const storyCommentText = 'Playwright story comment from follower';
    await followerPage.getByTestId('story-comment-input').fill(storyCommentText);
    await followerPage.getByTestId('story-comment-submit').click();
    await expect(followerPage.getByTestId('story-comment-row').filter({ hasText: storyCommentText })).toBeVisible();

    await ownerPage.goto('/');
    await ownerPage.getByTestId('story-bubble-own').click();
    await expect(ownerPage.getByTestId('story-like-count')).not.toHaveText('0 likes');
    await expect(ownerPage.getByTestId('story-comment-row').filter({ hasText: storyCommentText })).toBeVisible();

    ownerPage.once('dialog', (dialog) => dialog.accept());
    await ownerPage.getByTestId('story-delete').click();

    await waitFor(async () => {
      const result = await query('SELECT 1 FROM stories WHERE id = $1', [storyId]);
      return result.rows.length === 0 ? true : null;
    }, { timeout: 30000, interval: 1000, message: 'deleted private story' });
  } finally {
    if (followerToken && ownerToken) {
      try {
        const followerView = await apiGet(request, `/api/users/${accounts.army.username}`, followerToken);
        if (followerView.user.follow_status) {
          await apiPost(request, `/api/follow/${followerView.user.id}`, followerToken);
        }
      } catch (error) {
        // Cleanup should not mask the test result.
      }
    }
    if (ownerToken) {
      try {
        const ownerProfile = await apiGet(request, `/api/users/${accounts.army.username}`, ownerToken);
        if (ownerProfile.user.is_private) {
          await apiPut(request, '/api/users/privacy', ownerToken);
        }
      } catch (error) {
        // Cleanup should not mask the test result.
      }
    }
    await ownerContext.close();
    await followerContext.close();
  }
});

test('expired stories are automatically deleted after 24 hours', async ({ page, request }) => {
  await login(page, accounts.poetry);
  const token = await getToken(page);

  const userResult = await query('SELECT id FROM users WHERE email = $1', [accounts.poetry.email]);
  const userId = userResult.rows[0].id;
  const inserted = await query(
    `INSERT INTO stories (user_id, image_url, created_at)
     VALUES ($1, $2, NOW() - INTERVAL '25 HOURS')
     RETURNING id`,
    [userId, 'http://localhost:8080/uploads/1770396732887-Screenshot-2025-11-22-000228.png']
  );
  const expiredStoryId = inserted.rows[0].id;

  const stories = await apiGet(request, '/api/stories', token);
  expect(stories.some(story => Number(story.id) === Number(expiredStoryId))).toBeFalsy();

  await waitFor(async () => {
    const result = await query('SELECT 1 FROM stories WHERE id = $1', [expiredStoryId]);
    return result.rows.length === 0 ? true : null;
  }, { timeout: 30000, interval: 1000, message: 'expired story cleanup' });
});
