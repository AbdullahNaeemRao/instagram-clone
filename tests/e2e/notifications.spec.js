const { test, expect } = require('@playwright/test');
const { accounts } = require('./helpers/accounts');
const { login, clickNav, getToken } = require('./helpers/session');
const { query, waitFor } = require('./helpers/db');
const { apiGet, apiPost } = require('./helpers/api');

test('activity notifications cover follows, post comments, comment likes, and replies', async ({ browser, request }) => {
  test.setTimeout(240000);

  const ownerContext = await browser.newContext();
  const actorContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const actorPage = await actorContext.newPage();

  try {
    await login(ownerPage, accounts.news);
    await login(actorPage, accounts.tech);

    const ownerToken = await getToken(ownerPage);
    const actorToken = await getToken(actorPage);

    const ownerUser = await apiGet(request, `/api/users/${accounts.news.username}`, actorToken);
    const ownerId = ownerUser.user.id;

    const ownerPostResult = await query(
      `SELECT p.id
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE u.email = $1
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [accounts.news.email]
    );
    const ownerPostId = ownerPostResult.rows[0].id;

    await apiPost(request, `/api/follow/${ownerId}`, actorToken);

    const postCommentText = `Playwright notification post comment ${Date.now()}`;
    await apiPost(request, `/api/posts/${ownerPostId}/comments`, actorToken, { text: postCommentText });

    const ownerCommentText = `Owner comment for notification test ${Date.now()}`;
    const ownerComment = await apiPost(request, `/api/posts/${ownerPostId}/comments`, ownerToken, { text: ownerCommentText });
    const ownerCommentId = ownerComment.comment.id;

    await apiPost(request, `/api/comments/${ownerCommentId}/like`, actorToken);

    const replyText = `Playwright reply notification ${Date.now()}`;
    await apiPost(request, `/api/posts/${ownerPostId}/comments`, actorToken, {
      text: replyText,
      parent_comment_id: ownerCommentId,
    });

    await waitFor(async () => {
      const counts = await apiGet(request, '/api/notifications/count', ownerToken);
      return counts.activity >= 4 ? counts : null;
    }, { timeout: 30000, interval: 1000, message: 'notification activity count' });

    await clickNav(ownerPage, 'notifications');
    await expect(ownerPage.getByTestId('activity-modal')).toBeVisible();

    await expect(ownerPage.locator(`[data-testid="activity-notification-row"][data-type="follow"][data-username="${accounts.tech.username}"]`).first()).toBeVisible();
    await expect(ownerPage.locator(`[data-testid="activity-notification-row"][data-type="post_comment"][data-username="${accounts.tech.username}"]`).filter({ hasText: postCommentText }).first()).toBeVisible();
    await expect(ownerPage.locator(`[data-testid="activity-notification-row"][data-type="comment_like"][data-username="${accounts.tech.username}"]`).filter({ hasText: ownerCommentText }).first()).toBeVisible();
    await expect(ownerPage.locator(`[data-testid="activity-notification-row"][data-type="comment_reply"][data-username="${accounts.tech.username}"]`).filter({ hasText: replyText }).first()).toBeVisible();

    await ownerPage.getByTestId('activity-modal').click({ position: { x: 5, y: 5 } });

    await waitFor(async () => {
      const counts = await apiGet(request, '/api/notifications/count', ownerToken);
      return counts.activity === 0 ? true : null;
    }, { timeout: 30000, interval: 1000, message: 'notifications read count reset' });
  } finally {
    await ownerContext.close();
    await actorContext.close();
  }
});
