const { test, expect } = require('@playwright/test');
const { accounts } = require('./helpers/accounts');
const { login, clickNav, getToken } = require('./helpers/session');
const { apiGet, apiPut } = require('./helpers/api');

test('private account follow requests, notifications, acceptance, and follower removal work end-to-end', async ({ browser, request }) => {
  test.setTimeout(240000);

  const ownerContext = await browser.newContext();
  const requesterContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const requesterPage = await requesterContext.newPage();

  let ownerToken = null;

  try {
    await login(ownerPage, accounts.army);
    ownerToken = await getToken(ownerPage);
    await clickNav(ownerPage, 'profile');
    await ownerPage.getByTestId('profile-settings-button').click();
    await expect(ownerPage.getByTestId('settings-modal')).toBeVisible();
    await ownerPage.getByTestId('settings-private-toggle').click();
    await ownerPage.getByRole('button', { name: 'Done' }).click();

    await login(requesterPage, accounts.tech);
    await clickNav(requesterPage, 'search');
    await expect(requesterPage.getByTestId('search-page')).toBeVisible();
    await requesterPage.getByTestId('search-input').fill(accounts.army.username);

    const resultRow = requesterPage.locator(`[data-testid="search-result-row"][data-username="${accounts.army.username}"]`);
    await expect(resultRow).toBeVisible();
    await resultRow.click();

    await expect(requesterPage).toHaveURL(new RegExp(`/u/${accounts.army.username}$`));
    await expect(requesterPage.getByTestId('profile-restricted')).toBeVisible();
    await requesterPage.getByTestId('profile-follow-button').click();
    await expect(requesterPage.getByTestId('profile-follow-button')).toContainText('Requested');

    await clickNav(ownerPage, 'notifications');
    const requestRow = ownerPage.locator(`[data-testid="follow-request-row"][data-username="${accounts.tech.username}"]`);
    await expect(ownerPage.getByTestId('activity-modal')).toBeVisible();
    await expect(requestRow).toBeVisible();
    await requestRow.getByTestId('follow-request-confirm').click();
    await expect(requestRow).toHaveCount(0);

    await requesterPage.reload();
    await expect(requesterPage.getByTestId('profile-posts-grid')).toBeVisible();
    await expect(requesterPage.getByTestId('profile-follow-button')).toContainText('Following');

    await ownerPage.getByTestId('activity-modal').click({ position: { x: 5, y: 5 } });
    await clickNav(ownerPage, 'profile');
    await ownerPage.getByTestId('profile-manage-followers-button').click();

    const followersModal = ownerPage.getByTestId('user-list-modal-followers');
    const followerRow = followersModal.locator(`[data-testid="user-list-row"][data-username="${accounts.tech.username}"]`);
    await expect(followerRow).toBeVisible();
    ownerPage.once('dialog', (dialog) => dialog.accept());
    await followerRow.getByTestId('user-list-remove-follower').click();
    await expect(followerRow).toHaveCount(0);

    await requesterPage.reload();
    await expect(requesterPage.getByTestId('profile-restricted')).toBeVisible();
    await expect(requesterPage.getByTestId('profile-follow-button')).toContainText('Follow');
  } finally {
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
    await requesterContext.close();
  }
});

test('following modal lets a user unfollow directly', async ({ page }) => {
  await login(page, accounts.tech);

  await clickNav(page, 'search');
  await page.getByTestId('search-input').fill(accounts.news.username);

  const resultRow = page.locator(`[data-testid="search-result-row"][data-username="${accounts.news.username}"]`);
  await expect(resultRow).toBeVisible();
  await resultRow.click();

  const followButton = page.getByTestId('profile-follow-button');
  if ((await followButton.textContent())?.trim() !== 'Following') {
    await followButton.click();
    await expect(followButton).toContainText('Following');
  }

  await clickNav(page, 'profile');
  await page.getByTestId('profile-following-button').click();

  const followingModal = page.getByTestId('user-list-modal-following');
  const followingRow = followingModal.locator(`[data-testid="user-list-row"][data-username="${accounts.news.username}"]`);
  await expect(followingRow).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await followingRow.getByTestId('user-list-unfollow-following').click();
  await expect(followingRow).toHaveCount(0);
});
