const { test, expect } = require('@playwright/test');
const { accounts } = require('./helpers/accounts');
const { login, clickNav } = require('./helpers/session');

test('user can log in and navigate home, explore, and profile', async ({ page }) => {
  await login(page, accounts.gaming);

  await expect(page.getByText('Recommended for you')).toBeVisible();
  await expect(page.getByTestId('feed-post-card').first()).toBeVisible();

  await clickNav(page, 'explore');
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByTestId('explore-grid')).toBeVisible();
  await expect(page.getByTestId('explore-post-tile').first()).toBeVisible();

  await clickNav(page, 'profile');
  await expect(page).toHaveURL(new RegExp(`/u/${accounts.gaming.username}$`));
  await expect(page.getByRole('heading', { name: accounts.gaming.username, exact: true })).toBeVisible();
});
