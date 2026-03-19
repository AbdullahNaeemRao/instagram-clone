const { test, expect } = require('@playwright/test');
const { accounts, OCR_FIXTURE_IMAGE } = require('./helpers/accounts');
const { login, clickNav } = require('./helpers/session');

test('user can create a conversation and send, edit, reply to, image-send, and delete messages', async ({ page }) => {
  test.setTimeout(180000);

  await login(page, accounts.tech);
  await clickNav(page, 'messages');
  await expect(page.getByTestId('chat-inbox')).toBeVisible();

  await page.getByTestId('chat-new-message').click();
  await expect(page.getByTestId('new-message-modal')).toBeVisible();
  await page.getByTestId('new-message-search-input').fill(accounts.gaming.username);

  const targetResult = page.locator(`[data-testid="new-message-result"][data-username="${accounts.gaming.username}"]`);
  await expect(targetResult).toBeVisible();
  await targetResult.click();

  await expect(page.getByTestId('chat-view')).toBeVisible();

  const originalMessage = 'Playwright DM root message';
  await page.getByTestId('chat-input').fill(originalMessage);
  await page.getByTestId('chat-send-button').click();

  let mineRows = page.locator('[data-testid="chat-message-row"][data-is-mine="true"]');
  await expect(mineRows.last().getByTestId('chat-message-text')).toHaveText(originalMessage);

  const firstOwnMessage = mineRows.last();
  await firstOwnMessage.hover();
  await firstOwnMessage.getByTestId('chat-message-edit').click();
  await expect(page.getByTestId('chat-edit-banner')).toBeVisible();

  const editedMessage = 'Playwright DM edited message';
  await page.getByTestId('chat-input').fill(editedMessage);
  await page.getByTestId('chat-send-button').click();
  await expect(mineRows.last().getByTestId('chat-message-text')).toHaveText(editedMessage);

  const editedRow = mineRows.last();
  await editedRow.hover();
  await editedRow.getByTestId('chat-message-reply').click();
  await expect(page.getByTestId('chat-reply-banner')).toBeVisible();

  const replyMessage = 'Playwright DM reply message';
  await page.getByTestId('chat-input').fill(replyMessage);
  await page.getByTestId('chat-send-button').click();

  mineRows = page.locator('[data-testid="chat-message-row"][data-is-mine="true"]');
  await expect(mineRows.last().getByTestId('chat-message-text')).toHaveText(replyMessage);

  await page.getByTestId('chat-image-input').setInputFiles(OCR_FIXTURE_IMAGE);
  mineRows = page.locator('[data-testid="chat-message-row"][data-is-mine="true"]');
  const imageRow = mineRows.last();
  await expect(imageRow.getByTestId('chat-message-image')).toBeVisible();
  const imageMessageId = await imageRow.getAttribute('data-message-id');

  page.once('dialog', (dialog) => dialog.accept());
  await imageRow.hover();
  await imageRow.getByTestId('chat-message-delete').click();
  await expect(page.locator(`[data-testid="chat-message-row"][data-message-id="${imageMessageId}"]`)).toHaveCount(0);

  await page.getByTestId('chat-header-profile').click();
  await expect(page).toHaveURL(new RegExp(`/u/${accounts.gaming.username}$`));
});
