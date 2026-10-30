import { expect, test } from "@playwright/test";

test("create an event, import teams and fixtures, then restore the same event", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "＋ New event", exact: true }).click();
  const name = `Browser check ${Date.now()}`;
  await page.getByLabel("Event name", { exact: true }).fill(name);
  await page.getByLabel("Total order budget", { exact: true }).fill("350.25");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.getByRole("button", { name: "Teams 0", exact: true }).click();
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await page
    .getByLabel("CSV contents", { exact: true })
    .fill(
      "name,code,XS,S,M,L,XL,XXL\nEastfield FC,EFC,0,3,5,4,0,0\nWestbridge Athletic,WBA,0,4,4,4,0,0",
    );
  await expect(page.getByRole("button", { name: "Confirm import", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Preview rows", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Eastfield FC");
  await page.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Fixtures 0", exact: true }).click();
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await page
    .getByLabel("CSV contents", { exact: true })
    .fill("label,team_a,team_b\nOpening match,EFC,WBA");
  await page.getByRole("button", { name: "Preview rows", exact: true }).click();
  await page.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fixtures 1", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByRole("button", { name: "Teams 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fixtures 1", exact: true })).toBeVisible();
  await expect(page.getByText("€350.25", { exact: true })).toBeVisible();
});
