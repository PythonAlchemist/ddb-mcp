import { BrowserContext, Page } from "playwright";
import { getPage } from "../browser.js";

// ─── Value Maps ──────────────────────────────────────────────────────────────

const SIZE_MAP: Record<string, string> = {
  "Tiny": "2", "Small": "3", "Medium": "4",
  "Large": "5", "Huge": "6", "Gargantuan": "7",
};

const ALIGNMENT_MAP: Record<string, string> = {
  "Lawful Good": "1", "Neutral Good": "2", "Chaotic Good": "3",
  "Lawful Neutral": "4", "Neutral": "5", "True Neutral": "5",
  "Chaotic Neutral": "6", "Lawful Evil": "7", "Neutral Evil": "8",
  "Chaotic Evil": "9", "Unaligned": "10", "Any Alignment": "11",
  "Any Non-Good Alignment": "12", "Any Non-Lawful Alignment": "13",
  "Any Chaotic Alignment": "14", "Any Evil Alignment": "15",
};

// CR string → form option value
// CR 0→"1", 1/8→"2", 1/4→"3", 1/2→"4", 1→"5", 2→"6", ..., 30→"34"
const CR_MAP: Record<string, string> = {
  "0": "1", "1/8": "2", "1/4": "3", "1/2": "4",
};
for (let i = 1; i <= 30; i++) CR_MAP[String(i)] = String(i + 4);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActionEntry {
  name: string;
  description: string;
}

export interface MonsterData {
  name?: string;
  size?: string;
  type?: string;
  alignment?: string;
  ac?: string;
  ac_type?: string;
  hp?: string;
  hit_dice?: string;
  speed?: string;
  passive_perception?: string;
  abilities?: Record<string, { score: number; save?: string }>;
  traits?: ActionEntry[];
  actions?: ActionEntry[];
  bonus_actions?: ActionEntry[];
  reactions?: ActionEntry[];
  legendary_actions?: ActionEntry[];
  mythic_actions?: ActionEntry[];
  lair?: ActionEntry[];
  lore?: string;
  challenge?: string;
}

export interface ItemData {
  name?: string;
  type?: string;
  rarity?: string;
  attunement?: boolean;
  attunement_description?: string;
  description?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function dismissOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll(".vex, .vex-overlay, .vex-content").forEach(el => el.remove());
    document.querySelectorAll("*").forEach(el => {
      const style = getComputedStyle(el);
      if ((style.position === "fixed" || style.position === "absolute") &&
          style.zIndex && parseInt(style.zIndex) > 100 &&
          !el.closest("#monster-form") && !el.closest("form") && !el.closest("nav") && !el.closest("header")) {
        el.remove();
      }
    });
  });
  await page.waitForTimeout(500);
}

// ─── Monster Form ────────────────────────────────────────────────────────────

async function fillMonsterForm(page: Page, data: MonsterData): Promise<void> {
  await page.evaluate(({ data, SIZE_MAP, ALIGNMENT_MAP, CR_MAP }) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;

    const setInput = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const setSelect = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const setCheckbox = (id: string, checked: boolean) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      if (el.checked !== checked) {
        el.checked = checked;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };

    const setDescription = (baseName: string, html: string) => {
      // Set markup type to Raw Html (value "6")
      const typeField = document.getElementById(`field-${baseName}-type`) as HTMLSelectElement | null;
      if (typeField) {
        typeField.value = "6";
        typeField.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Set the plain textarea via direct .value assignment
      const textarea = document.getElementById(`field-${baseName}`);
      if (textarea) {
        (textarea as any).value = html;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Also set wysiwyg textarea
      const wysiwygEl = document.getElementById(`field-${baseName}-wysiwyg`);
      if (wysiwygEl) {
        (wysiwygEl as any).value = html;
      }
      // Set TinyMCE editor content
      if (typeof (window as any).tinymce !== "undefined") {
        const editor = (window as any).tinymce.get(`field-${baseName}-wysiwyg`);
        if (editor) editor.setContent(html);
      }
    };

    const toHtml = (entries: Array<{ name: string; description: string }>) =>
      entries.map(e =>
        e.name === "_intro"
          ? `<p>${e.description}</p>`
          : `<p><em><strong>${e.name}.</strong></em> ${e.description}</p>`
      ).join("\n");

    // Basic fields
    if (data.name !== undefined) setInput("field-Name", data.name);
    if (data.size !== undefined) setSelect("field-size", SIZE_MAP[data.size] ?? "");
    if (data.alignment !== undefined) setSelect("field-alignment", ALIGNMENT_MAP[data.alignment] ?? "");
    if (data.ac !== undefined) setInput("field-armor-class", data.ac);
    if (data.ac_type !== undefined) setInput("field-armor-class-type", data.ac_type);
    if (data.hp !== undefined) setInput("field-average-hit-points", data.hp);
    if (data.passive_perception !== undefined) setInput("field-passive-perception", data.passive_perception);

    // Challenge Rating
    if (data.challenge !== undefined) {
      const crNum = data.challenge.match(/^([\d/]+)/)?.[1] ?? data.challenge;
      const crValue = CR_MAP[crNum];
      if (crValue) setSelect("field-challenge-rating", crValue);
    }

    // Hit Dice
    if (data.hit_dice !== undefined) {
      const hdMatch = data.hit_dice.match(/(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?/);
      if (hdMatch) {
        setInput("field-hit-points-die-count", hdMatch[1]);
        setSelect("field-hit-points-die-value", hdMatch[2]);
        const sign = hdMatch[3] === "-" ? "-" : "";
        setInput("field-hit-points-modifier", sign + (hdMatch[4] ?? "0"));
      }
    }

    // Monster Type — match by option text
    if (data.type !== undefined) {
      const typeSelect = document.getElementById("field-monster-type") as HTMLSelectElement | null;
      if (typeSelect) {
        const option = Array.from(typeSelect.options).find(
          o => o.text.toLowerCase() === data.type!.toLowerCase()
        );
        if (option) {
          typeSelect.value = option.value;
          typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }

    // Ability Scores
    if (data.abilities) {
      const abilityFieldMap: Record<string, string> = {
        STR: "strength", DEX: "dexterity", CON: "constitution",
        INT: "intelligence", WIS: "wisdom", CHA: "charisma",
      };
      for (const [key, val] of Object.entries(data.abilities)) {
        const fieldName = abilityFieldMap[key];
        if (!fieldName) continue;
        const ability = val as { score: number; save?: string };
        setInput(`field-${fieldName}`, String(ability.score));
        if (ability.save !== undefined) {
          setInput(`field-${fieldName}-save-bonus`, ability.save);
        }
      }
    }

    // Checkboxes
    if (data.legendary_actions !== undefined) {
      setCheckbox("field-is-legendary", data.legendary_actions.length > 0);
    }
    if (data.mythic_actions !== undefined) {
      setCheckbox("field-is-mythic", data.mythic_actions.length > 0);
    }
    if (data.lair !== undefined) {
      setCheckbox("field-has-lair", data.lair.length > 0);
    }

    // HTML Description Fields
    if (data.traits !== undefined) setDescription("special-traits-description", toHtml(data.traits));
    if (data.actions !== undefined) setDescription("actions-description", toHtml(data.actions));
    if (data.bonus_actions !== undefined) setDescription("bonus-actions-description", toHtml(data.bonus_actions));
    if (data.reactions !== undefined) setDescription("reactions-description", toHtml(data.reactions));
    if (data.legendary_actions !== undefined) setDescription("legendary-actions-description", toHtml(data.legendary_actions));
    if (data.mythic_actions !== undefined) setDescription("mythic-actions-description", toHtml(data.mythic_actions));
    if (data.lair !== undefined) setDescription("lair-description", toHtml(data.lair));
    if (data.lore !== undefined) setDescription("monster-characteristics-description", `<p>${data.lore}</p>`);

  }, {
    data: data as any,
    SIZE_MAP,
    ALIGNMENT_MAP,
    CR_MAP,
  });
}

// ─── Monster CRUD ────────────────────────────────────────────────────────────

export async function editMonster(
  context: BrowserContext,
  id: string,
  data: MonsterData
): Promise<string> {
  const page = await getPage(context);
  const editUrl = `https://www.dndbeyond.com/homebrew/creations/monsters/${id}/edit`;

  await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  await dismissOverlays(page);

  const hasForm = await page.evaluate(() => !!document.getElementById("monster-form"));
  if (!hasForm) {
    throw new Error(`Monster form not found at ${editUrl}. Check the monster ID.`);
  }

  await fillMonsterForm(page, data);

  await dismissOverlays(page);
  await page.evaluate(() => {
    (document.getElementById("monster-form") as HTMLFormElement | null)?.submit();
  });

  await page.waitForTimeout(8000);
  const finalUrl = page.url();

  return JSON.stringify({
    status: "saved",
    url: finalUrl,
    id,
    name: data.name ?? "(unchanged)",
  }, null, 2);
}

export async function createMonster(
  context: BrowserContext,
  data: MonsterData
): Promise<string> {
  if (!data.name) throw new Error("Monster name is required for creation.");

  const page = await getPage(context);

  await page.goto("https://www.dndbeyond.com/homebrew/creations/create-monster/create", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  await dismissOverlays(page);

  const hasForm = await page.evaluate(() => !!document.getElementById("monster-form"));
  if (!hasForm) {
    try {
      await page.locator('a:has-text("CREATE FROM SCRATCH"), a:has-text("Create from Scratch")').first().click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      await dismissOverlays(page);
    } catch {
      throw new Error("Monster create form not found. Navigation may have failed.");
    }
  }

  await fillMonsterForm(page, data);

  await dismissOverlays(page);
  await page.evaluate(() => {
    (document.getElementById("monster-form") as HTMLFormElement | null)?.submit();
  });

  await page.waitForTimeout(8000);
  const finalUrl = page.url();

  const idMatch = finalUrl.match(/\/monsters\/(\d+-[^/]+)\/edit/);
  const newId = idMatch?.[1] ?? "";

  return JSON.stringify({
    status: "created",
    url: finalUrl,
    id: newId,
    name: data.name,
  }, null, 2);
}

// ─── Item Form ───────────────────────────────────────────────────────────────

const ITEM_RARITY_MAP: Record<string, string> = {
  "Common": "1", "Uncommon": "2", "Rare": "3",
  "Very Rare": "4", "Legendary": "5", "Artifact": "7",
  "Varies": "9", "Unknown Rarity": "10",
};

async function fillItemForm(page: Page, data: ItemData): Promise<void> {
  await page.evaluate(({ data, ITEM_RARITY_MAP }) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;

    const setInput = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const setSelect = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    // Item name field is "field-name" (lowercase n)
    if (data.name !== undefined) setInput("field-name", data.name);

    if (data.rarity !== undefined) {
      const rarityValue = ITEM_RARITY_MAP[data.rarity];
      if (rarityValue) setSelect("field-rarity", rarityValue);
    }

    // Item type — field-type select, match by option text
    if (data.type !== undefined) {
      const typeSelect = document.getElementById("field-type") as HTMLSelectElement | null;
      if (typeSelect) {
        const option = Array.from(typeSelect.options).find(
          o => o.text.toLowerCase().includes(data.type!.toLowerCase())
        );
        if (option) {
          typeSelect.value = option.value;
          typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }

    // Attunement checkbox
    if (data.attunement !== undefined) {
      const el = document.getElementById("field-requires-attunement") as HTMLInputElement | null;
      if (el && el.checked !== data.attunement) {
        el.checked = data.attunement;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // Attunement description
    if (data.attunement_description !== undefined) {
      setInput("field-attunement-description", data.attunement_description);
    }

    // Description — field-item-description (textarea) + field-item-description-type (hidden input)
    if (data.description !== undefined) {
      // Set markup type to Raw Html (value "6") — hidden input, use nativeSetter
      const typeField = document.getElementById("field-item-description-type") as HTMLInputElement | null;
      if (typeField) {
        nativeSetter.call(typeField, "6");
        typeField.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Set the plain textarea
      const textarea = document.getElementById("field-item-description");
      if (textarea) {
        (textarea as any).value = data.description;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Set the wysiwyg textarea
      const wysiwygEl = document.getElementById("field-item-description-wysiwyg");
      if (wysiwygEl) {
        (wysiwygEl as any).value = data.description;
      }
      // Set TinyMCE editor
      if (typeof (window as any).tinymce !== "undefined") {
        const editor = (window as any).tinymce.get("field-item-description-wysiwyg");
        if (editor) editor.setContent(data.description);
      }
    }
  }, { data: data as any, ITEM_RARITY_MAP });
}

// ─── Item CRUD ───────────────────────────────────────────────────────────────

function getItemFormId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const form = document.querySelector(
      "#magic-item-form, form[id*='item'], form[id*='magic']"
    ) as HTMLFormElement | null;
    return form?.id ?? null;
  });
}

export async function editItem(
  context: BrowserContext,
  id: string,
  data: ItemData
): Promise<string> {
  const page = await getPage(context);
  const editUrl = `https://www.dndbeyond.com/homebrew/creations/magic-items/${id}/edit`;

  await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  await dismissOverlays(page);

  const formId = await getItemFormId(page);
  if (!formId) throw new Error(`Item form not found at ${editUrl}. Check the item ID.`);

  await fillItemForm(page, data);

  await dismissOverlays(page);
  await page.evaluate((fid: string) => {
    (document.getElementById(fid) as HTMLFormElement | null)?.submit();
  }, formId);

  await page.waitForTimeout(8000);
  const finalUrl = page.url();

  return JSON.stringify({
    status: "saved",
    url: finalUrl,
    id,
    name: data.name ?? "(unchanged)",
  }, null, 2);
}

export async function createItem(
  context: BrowserContext,
  data: ItemData
): Promise<string> {
  if (!data.name) throw new Error("Item name is required for creation.");

  const page = await getPage(context);

  await page.goto("https://www.dndbeyond.com/homebrew/creations/create-magic-item/create", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  await dismissOverlays(page);

  let formId = await getItemFormId(page);
  if (!formId) {
    try {
      await page.locator('a:has-text("CREATE FROM SCRATCH"), a:has-text("Create from Scratch")').first().click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      await dismissOverlays(page);
      formId = await getItemFormId(page);
    } catch {
      throw new Error("Item create form not found.");
    }
  }

  await fillItemForm(page, data);

  await dismissOverlays(page);
  if (formId) {
    await page.evaluate((fid: string) => {
      (document.getElementById(fid) as HTMLFormElement | null)?.submit();
    }, formId);
  }

  await page.waitForTimeout(8000);
  const finalUrl = page.url();

  // Extract item ID from redirect URL — could be various patterns
  const idMatch = finalUrl.match(/\/(?:magic-items|edit-magic-item)\/(\d+-[^/]+)/);
  const newId = idMatch?.[1] ?? "";

  return JSON.stringify({
    status: "created",
    url: finalUrl,
    id: newId,
    name: data.name,
  }, null, 2);
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteHomebrew(
  context: BrowserContext,
  type: "monster" | "item",
  id: string
): Promise<string> {
  const page = await getPage(context);
  const category = type === "monster" ? "monsters" : "magic-items";
  const viewUrl = `https://www.dndbeyond.com/${category}/${id}`;

  await page.goto(viewUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await dismissOverlays(page);

  // Auto-accept any native browser confirm() dialogs
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });

  // Click the DELETE button/link
  const deleteClicked = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a, button"));
    const deleteEl = links.find(el => el.textContent?.trim().toUpperCase() === "DELETE");
    if (deleteEl) {
      (deleteEl as HTMLElement).click();
      return true;
    }
    return false;
  });

  if (!deleteClicked) {
    // Check if already deleted (shows RESTORE instead)
    const isAlreadyDeleted = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a, button"));
      return links.some(el => el.textContent?.trim().toUpperCase() === "RESTORE");
    });
    if (isAlreadyDeleted) {
      return JSON.stringify({ status: "already_deleted", type, id }, null, 2);
    }
    throw new Error(`DELETE button not found on ${viewUrl}. You may not own this creation.`);
  }

  // Wait for any confirmation dialog (vex modal) and try to confirm
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    // Try vex dialog confirm button
    const confirmBtn = document.querySelector(
      ".vex-dialog-button-primary, .vex-dialog-buttons button:first-child"
    ) as HTMLElement | null;
    if (confirmBtn) {
      confirmBtn.click();
      return;
    }
    // Fallback: any OK/Yes/Confirm/Delete button in a modal
    const buttons = Array.from(document.querySelectorAll(".vex button, .modal button, dialog button"));
    const okBtn = buttons.find(b =>
      /^(ok|yes|confirm|delete)$/i.test(b.textContent?.trim() ?? "")
    ) as HTMLElement | null;
    if (okBtn) okBtn.click();
  });

  await page.waitForTimeout(5000);

  return JSON.stringify({
    status: "deleted",
    type,
    id,
  }, null, 2);
}
