const { test, expect } = require('@playwright/test');
const { logout } = require('./helpers/session');
const { query } = require('./helpers/db');

test('user can register, log in, and log out', async ({ page }) => {
  const uniqueSuffix = `${Date.now()}`;
  const account = {
    username: `playwright_user_${uniqueSuffix}`,
    email: `playwright.${uniqueSuffix}@example.local`,
    password: 'Playwright123!',
  };

  await page.goto('/login');
  await page.getByTestId('auth-mode-toggle').click();
  await page.getByTestId('register-username-input').fill(account.username);
  await page.getByTestId('login-email-input').fill(account.email);
  await page.getByTestId('login-password-input').fill(account.password);
  await page.getByTestId('login-submit').click();

  await expect(page.getByTestId('register-username-input')).toHaveCount(0);

  await page.getByTestId('login-email-input').fill(account.email);
  await page.getByTestId('login-password-input').fill(account.password);
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByTestId('login-submit').click(),
  ]);
  await expect(page.getByTestId('home-feed')).toBeVisible();

  await logout(page);

  await page.getByTestId('login-email-input').fill(account.username);
  await page.getByTestId('login-password-input').fill(account.password);
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByTestId('login-submit').click(),
  ]);
  await expect(page.getByTestId('home-feed')).toBeVisible();

  await logout(page);

  await query('DELETE FROM users WHERE email = $1', [account.email]);
});
