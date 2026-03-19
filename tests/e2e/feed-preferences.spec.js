const { test, expect } = require('@playwright/test');
const { accounts } = require('./helpers/accounts');
const { login, clickNav } = require('./helpers/session');

test('comment links open profiles and preference tabs reflect interested and not interested posts', async ({ page }) => {
  await login(page, accounts.tech);

  const firstPost = page.getByTestId('feed-post-card').first();
  await firstPost.getByTestId('feed-post-comments-toggle').click();
  await firstPost.getByTestId('feed-post-comment-input').fill('Playwright comment profile check');
  await firstPost.getByTestId('feed-post-comment-submit').click();
  const newComment = firstPost.getByTestId('comment-item').filter({ hasText: 'Playwright comment profile check' }).first();
  await newComment.getByText(accounts.tech.username, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${accounts.tech.username}$`));

  await clickNav(page, 'home');
  await expect(page.getByTestId('feed-post-card').first()).toBeVisible();

  const interestedPost = page.getByTestId('feed-post-card').first();
  const interestedPostId = await interestedPost.getAttribute('data-post-id');
  await interestedPost.getByTestId('feed-post-interested').click();
  await expect(page.getByText('We will show more posts like this.')).toBeVisible();

  const hiddenPost = page.getByTestId('feed-post-card').nth(1);
  const hiddenPostId = await hiddenPost.getAttribute('data-post-id');
  await hiddenPost.getByTestId('feed-post-not-interested').click();
  await expect(page.locator(`[data-testid="feed-post-card"][data-post-id="${hiddenPostId}"]`)).toHaveCount(0);

  await clickNav(page, 'profile');
  await page.getByTestId('profile-tab-preferences').click();

  const interestedSection = page.getByTestId('preferences-section-interested');
  const notInterestedSection = page.getByTestId('preferences-section-not-interested');

  await expect(interestedSection.locator(`[data-post-id="${interestedPostId}"]`)).toBeVisible();
  await expect(notInterestedSection.locator(`[data-post-id="${hiddenPostId}"]`)).toBeVisible();

  await notInterestedSection.locator(`[data-post-id="${hiddenPostId}"]`).getByTestId('preference-reset').click();
  await expect(notInterestedSection.locator(`[data-post-id="${hiddenPostId}"]`)).toHaveCount(0);
});
