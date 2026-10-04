import { expect, test } from "@playwright/test";

test("login page keeps account/password as its only sign-in method", async ({ page }) => {
  await page.goto("/#/login");

  await expect(
    page.getByRole("heading", { name: "登录到工作台" })
  ).toBeVisible();
  const loginForm = page.locator("form");
  await expect(loginForm).toHaveCount(1);
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
  await expect(page.getByLabel("账号")).toHaveAttribute(
    "autocomplete",
    "username"
  );
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute(
    "autocomplete",
    "current-password"
  );
  await expect(loginForm.getByRole("button", { name: "登录" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "忘记密码？" })).toBeVisible();
  await expect(
    loginForm.locator(
      'input[type="email"], input[type="tel"], input[autocomplete="one-time-code"]'
    )
  ).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(
    page.getByText(
      /短信|邮箱验证码|魔法链接|第三方登录|单点登录|扫码登录|Passkey|Google 登录|GitHub 登录/i
    )
  ).toHaveCount(0);
});
