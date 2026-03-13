import { BrowserContext } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, basename, extname, join } from "path";
import { homedir } from "os";
import { getPage } from "../browser.js";

export async function navigate(context: BrowserContext, url: string): Promise<string> {
  const page = await getPage(context);

  // Only allow D&D Beyond URLs
  if (!url.startsWith("https://www.dndbeyond.com") && !url.startsWith("https://dndbeyond.com")) {
    throw new Error("Only D&D Beyond URLs (https://www.dndbeyond.com/...) are supported.");
  }

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  // Extract page text content and convert to readable markdown-ish format
  const content = await page.evaluate(() => {
    // Remove scripts and styles
    document.querySelectorAll("script, style, nav, footer, .ad-container, .advertisement").forEach((el) =>
      el.remove()
    );

    // Try to get the main content area
    const main =
      document.querySelector("main, article, .main-content, .page-content, #content") ?? document.body;

    return (main as HTMLElement).innerText;
  });

  const truncated = content.length > 50000 ? content.slice(0, 50000) + "\n\n[Content truncated — use ddb_read_book or a more specific URL to get full content]" : content;

  return `URL: ${url}\n\n${truncated}`;
}

export async function interact(
  context: BrowserContext,
  action: "click" | "fill" | "screenshot" | "evaluate",
  selector: string,
  value?: string
): Promise<string> {
  const page = await getPage(context);

  switch (action) {
    case "click": {
      await page.locator(selector).first().click();
      await page.waitForTimeout(1000);
      return `Clicked element: ${selector}`;
    }

    case "fill": {
      if (value === undefined) throw new Error("'value' is required for fill action.");
      await page.locator(selector).first().fill(value);
      await page.waitForTimeout(500);
      return `Filled '${selector}' with: ${value}`;
    }

    case "screenshot": {
      const screenshotPath = `/tmp/ddb-screenshot-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      return `Screenshot saved to: ${screenshotPath}`;
    }

    case "evaluate": {
      // The selector field contains the JavaScript expression to evaluate.
      // The expression is run in the page context and must return a
      // JSON-serialisable value (or a string).
      const result = await page.evaluate((expr: string) => {
        // eslint-disable-next-line no-eval
        const val = eval(expr);
        return typeof val === "string" ? val : JSON.stringify(val, null, 2);
      }, selector);
      return result ?? "(no result)";
    }

    default:
      throw new Error(`Unknown action: ${action}. Use 'click', 'fill', 'screenshot', or 'evaluate'.`);
  }
}

export async function downloadImage(
  context: BrowserContext,
  url: string,
  outputPath?: string
): Promise<string> {
  // Only allow D&D Beyond media URLs
  if (
    !url.startsWith("https://media.dndbeyond.com") &&
    !url.startsWith("https://www.dndbeyond.com")
  ) {
    throw new Error(
      "Only D&D Beyond URLs (media.dndbeyond.com or www.dndbeyond.com) are supported."
    );
  }

  // Determine output path
  const filename = basename(new URL(url).pathname) || `image-${Date.now()}.png`;
  const resolvedPath = outputPath
    ? outputPath
    : join(homedir(), "Downloads", filename);

  // Ensure output directory exists
  mkdirSync(dirname(resolvedPath), { recursive: true });

  // Use the browser context's request API to share cookies/session
  const response = await context.request.get(url);

  if (!response.ok()) {
    throw new Error(`Download failed: HTTP ${response.status()} ${response.statusText()}`);
  }

  const buffer = await response.body();
  writeFileSync(resolvedPath, buffer);

  const ext = extname(resolvedPath).toLowerCase();
  const sizeKB = Math.round(buffer.length / 1024);

  return JSON.stringify({
    path: resolvedPath,
    filename: basename(resolvedPath),
    size: `${sizeKB} KB`,
    type: ext.replace(".", ""),
    url,
  });
}

export async function getCurrentPageContent(context: BrowserContext): Promise<string> {
  const page = await getPage(context);
  const url = page.url();
  const content = await page.evaluate(() => {
    document.querySelectorAll("script, style, nav, footer, .ad-container").forEach((el) => el.remove());
    const main =
      document.querySelector("main, article, .main-content, .page-content") ?? document.body;
    return (main as HTMLElement).innerText;
  });

  const truncated = content.length > 50000 ? content.slice(0, 50000) + "\n[truncated]" : content;
  return `Current URL: ${url}\n\n${truncated}`;
}
