import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
test.describe.configure({ mode: "serial" });
test("standalone board, six views, evidence, themes, and responsive layout", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto((await readFile(".local-demo/ui-url.txt", "utf8")).trim());
  await expect(
    page.getByRole("heading", { name: "Your software, in motion." }),
  ).toBeVisible();
  const seed = await page
    .locator("#release-select option")
    .filter({ hasText: "Shipping confidence" })
    .getAttribute("value");
  await page.getByLabel("Selected release").selectOption(seed!);
  await expect(
    page.getByRole("button", { name: /Create the customer workspace/ }),
  ).toBeVisible();
  const accessible = async (surface: string) => {
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
      surface,
    ).toEqual([]);
  };
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page.getByRole("button", { name: "Toggle color theme" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const name of [
      "Factory board",
      "Release plan",
      "Workers",
      "Validation & review",
      "Decision inbox",
      "Activity",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.locator("main h1")).toHaveText(
        name === "Factory board" ? "Your software, in motion." : name,
      );
      await accessible(`${theme}: ${name}`);
      await page.screenshot({
        path: `artifacts/${name.replaceAll(/[^a-z]/gi, "-").toLowerCase()}-${theme}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await page
      .getByRole("button", { name: "Validation & review", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Independent review report/ })
      .click();
    await expect(page.getByRole("dialog")).toContainText("synthetic");
    await accessible(`${theme}: evidence dialog`);
    await page.getByRole("button", { name: "Close dialog" }).click();

    for (const [button, title] of [
      ["New release", "Plan a new release"],
      ["Feedback", "Feed it back into the factory"],
      ["Cancel", "Cancel this release?"],
    ]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveAccessibleName(title);
      await accessible(`${theme}: ${title}`);
      await page.screenshot({
        path: `artifacts/dialog-${button.toLowerCase().replaceAll(" ", "-")}-${theme}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Close dialog" }).click();
    }

    await page
      .getByRole("button", { name: "Factory board", exact: true })
      .click();
    await page.getByLabel("Filter issues").focus();
    await expect(page.locator(".search")).toHaveCSS("outline-style", "solid");
    await page.getByLabel("Filter issues").fill("customer workspace");
    await expect(page.locator(".issue-card")).toHaveCount(1);
    await page.getByLabel("Filter issues").fill("");
    await page.screenshot({
      path: `artifacts/factory-board-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await accessible(`${theme}: mobile board`);
    await page.screenshot({
      path: `artifacts/factory-mobile-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
test("Cancel closes required release form and creating a release runs three independent workers", async ({
  page,
}) => {
  await page.goto(
    (
      await (
        await page.request.get("http://127.0.0.1:4180/session-link")
      ).json()
    ).url,
  );
  await page.getByRole("button", { name: "New release", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New release", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption("forms");
  await page.getByLabel("Release name").fill("UI workflow verification");
  await page
    .getByLabel("One-sentence outcome")
    .fill("A user can inspect a verified candidate.");
  await page.getByLabel("Key", { exact: true }).fill("browser-check");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Build the browser fixture");
  await page
    .getByLabel("Acceptance criteria · one per line")
    .fill("The fixture file exists");
  await page
    .getByRole("button", { name: "Create release", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Start factory", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Factory board", exact: true })
    .click();
  await expect(
    page.locator(".issue-card .badge").filter({ hasText: "Merge ready" }),
  ).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Workers", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.locator("tbody")).toContainText("validator");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your software, in motion." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel release", exact: true })
    .click();
});
test("embedded App initializes through official AppBridge and host fullscreen", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4180/");
  const app = page.frameLocator("#app");
  await expect(
    app.getByRole("heading", { name: "Your software, in motion." }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).appInitialized))
    .toBe(true);
  await app.getByRole("button", { name: "Toggle fullscreen" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).displayMode))
    .toBe("fullscreen");
  await page.screenshot({
    path: "artifacts/factory-embedded.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("embedded light theme is respected and the first toggle changes it", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4180/?light");
  const app = page.frameLocator("#app");
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  await app.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  await app.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "artifacts/factory-embedded-light.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("unsupported host fullscreen uses open-link and rejected links reveal a usable fallback", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4180/?nofullscreen");
  let app = page.frameLocator("#app");
  await expect(
    app.getByRole("heading", { name: "Your software, in motion." }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Toggle fullscreen" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).openedLink))
    .toBe(true);
  await page.goto("http://127.0.0.1:4180/?rejectmode&linkerror");
  app = page.frameLocator("#app");
  await expect(
    app.getByRole("heading", { name: "Your software, in motion." }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Toggle fullscreen" }).click();
  await expect(
    app.getByRole("link", { name: "Open factory in browser" }),
  ).toBeVisible();
});
