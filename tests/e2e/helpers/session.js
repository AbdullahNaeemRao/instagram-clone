const { expect } = require('@playwright/test');

async function login(page, account) {
  await page.goto('/login');
  await page.getByTestId('login-email-input').fill(account.email);
  await page.getByTestId('login-password-input').fill(account.password);
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByTestId('login-submit').click(),
  ]);
  await expect(page.getByTestId('home-feed')).toBeVisible();
  await expect(page.getByTestId('feed-post-card').first()).toBeVisible();
}

async function getToken(page) {
  return page.evaluate(() => localStorage.getItem('token'));
}

async function clickNav(page, slug) {
  await page.getByTestId(`nav-item-${slug}`).click();
}

async function logout(page) {
  await clickNav(page, 'log-out');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-form')).toBeVisible();
}

module.exports = {
  login,
  getToken,
  clickNav,
  logout,
};
