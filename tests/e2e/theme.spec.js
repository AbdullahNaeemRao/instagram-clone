const { test, expect } = require('@playwright/test');
const { accounts } = require('./helpers/accounts');

test('app follows browser dark mode on auth and main shell', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');

  await expect(page.getByTestId('launch-screen')).toBeVisible();
  await expect(page.getByTestId('login-form')).toBeVisible();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('login-email-input').fill(accounts.tech.email);
  await page.getByTestId('login-password-input').fill(accounts.tech.password);
  await page.getByTestId('login-submit').click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('home-feed')).toBeVisible();
});
