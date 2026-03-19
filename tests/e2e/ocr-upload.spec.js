const { test, expect } = require('@playwright/test');
const { accounts, OCR_FIXTURE_IMAGE } = require('./helpers/accounts');
const { login, getToken } = require('./helpers/session');
const { query, waitFor } = require('./helpers/db');
const { apiPost } = require('./helpers/api');

test('uploading an image with no caption still produces OCR-backed analysis and a category', async ({ page, request }) => {
  test.setTimeout(180000);

  await login(page, accounts.poetry);
  const token = await getToken(page);

  const beforeResult = await query(
    `SELECT COALESCE(MAX(p.id), 0) AS max_id
     FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE u.email = $1`,
    [accounts.poetry.email]
  );
  const previousMaxId = Number(beforeResult.rows[0].max_id || 0);

  await page.getByTestId('nav-item-create').click();
  await expect(page.getByTestId('upload-modal')).toBeVisible();
  await page.getByTestId('upload-file-input').setInputFiles(OCR_FIXTURE_IMAGE);
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-modal')).toHaveCount(0);

  const analyzedPost = await waitFor(async () => {
    const result = await query(
      `SELECT p.id, p.category, p.analysis_status, p.ocr_text, p.analysis_text
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE u.email = $1
         AND p.id > $2
       ORDER BY p.id DESC
       LIMIT 1`,
      [accounts.poetry.email, previousMaxId]
    );

    const row = result.rows[0];
    if (!row || row.analysis_status !== 'ready') {
      return null;
    }
    return row;
  }, { timeout: 90000, interval: 2000, message: 'OCR-backed analysis result' });

  expect(analyzedPost.category).toBe('Tech');
  expect(analyzedPost.ocr_text.length).toBeGreaterThan(500);
  expect(analyzedPost.analysis_text.toLowerCase()).toContain('graphing with software');

  await apiPost(request, `/api/posts/${analyzedPost.id}/like`, token);
  const deleteResponse = await request.delete(`http://127.0.0.1:8080/api/posts/${analyzedPost.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(deleteResponse.ok()).toBeTruthy();
});
