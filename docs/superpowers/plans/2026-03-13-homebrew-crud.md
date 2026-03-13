# Homebrew CRUD Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ddb_create_monster`, `ddb_edit_monster`, `ddb_create_item`, and `ddb_edit_item` MCP tools to the ddb-mcp server.

**Architecture:** New `src/tools/homebrew.ts` file with form automation functions that accept structured JSON matching the read tools' output format. Each function navigates to DDB's homebrew form, fills fields via `page.evaluate()` (bypassing overlay issues), and submits via `form.submit()`. Tool registrations added to `src/index.ts`.

**Tech Stack:** TypeScript, Playwright, `@modelcontextprotocol/sdk`, Zod

---

## File Structure

- **Create:** `src/tools/homebrew.ts` — All CRUD functions + helpers (form field maps, HTML generators, field setters)
- **Modify:** `src/index.ts` — Register 4 new tools with Zod schemas
- **Reference:** `src/tools/compendium.ts` — Read tools whose output format defines the input shape
- **Reference:** `src/browser.ts` — `getPage()` for shared browser context
- **Reference:** `docs/specs/2026-03-13-homebrew-crud-design.md` — Full field mapping reference

---

## Chunk 1: Core Helpers + Edit Monster

### Task 1: Create `src/tools/homebrew.ts` with helpers

**Files:**
- Create: `src/tools/homebrew.ts`

- [ ] **Step 1: Create the file with imports, type definitions, and value maps**

```typescript
import { BrowserContext } from "playwright";
import { getPage } from "../browser.js";

// ─── Value Maps ──────────────────────────────────────────────────────────────
// These map display text from getMonster output → form <option> values

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
// CR 1 through 30 map to values 5 through 34
for (let i = 1; i <= 30; i++) CR_MAP[String(i)] = String(i + 4);

const HIT_DIE_MAP: Record<string, string> = {
  "4": "4", "6": "6", "8": "8", "10": "10", "12": "12", "20": "20",
};

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
  hit_dice?: string;            // "20d8 + 140"
  speed?: string;               // Not settable via simple field — deferred
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
  challenge?: string;           // "5" or "1/2" — the CR value
}

export interface ItemData {
  name?: string;
  type?: string;
  rarity?: string;
  attunement?: boolean;
  attunement_description?: string;
  description?: string;         // HTML or plain text
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert structured action entries to DDB's expected HTML format. */
function actionsToHtml(entries: ActionEntry[]): string {
  return entries.map(e =>
    e.name === "_intro"
      ? `<p>${e.description}</p>`
      : `<p><em><strong>${e.name}.</strong></em> ${e.description}</p>`
  ).join("\n");
}

/** Parse "20d8 + 140" → { count: "20", value: "8", modifier: "140" } */
function parseHitDice(str: string): { count: string; value: string; modifier: string } | null {
  const m = str.match(/(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?/);
  if (!m) return null;
  const sign = m[3] === "-" ? "-" : "";
  return { count: m[1], value: m[2], modifier: sign + (m[4] ?? "0") };
}

/** Extract CR number from challenge string like "5 (1,800 XP)" or just "5" */
function parseCR(challenge: string): string {
  const m = challenge.match(/^([\d/]+)/);
  return m?.[1] ?? challenge;
}

/** Remove vex overlays and wait briefly */
async function dismissOverlays(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll(".vex, .vex-overlay, .vex-content").forEach(el => el.remove());
    // Remove any high-z-index fixed overlays that aren't the form
    document.querySelectorAll("*").forEach(el => {
      const style = getComputedStyle(el);
      if ((style.position === "fixed" || style.position === "absolute") &&
          style.zIndex && parseInt(style.zIndex) > 100 &&
          !el.closest("#monster-form") && !el.closest("nav") && !el.closest("header")) {
        el.remove();
      }
    });
  });
  await page.waitForTimeout(500);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`
Expected: No errors (file has no exports used yet, but should compile cleanly)

- [ ] **Step 3: Commit**

```bash
git add src/tools/homebrew.ts
git commit -m "feat: add homebrew.ts with helper functions and value maps"
```

### Task 2: Implement `fillMonsterForm` shared function

**Files:**
- Modify: `src/tools/homebrew.ts`

This is the core function used by both create and edit. It takes a page with the monster form loaded and fills in the provided fields.

- [ ] **Step 1: Add `fillMonsterForm` function**

```typescript
/**
 * Fill monster form fields on the currently loaded DDB homebrew form page.
 * Only sets fields that are present in the data object.
 */
async function fillMonsterForm(page: import("playwright").Page, data: MonsterData): Promise<void> {
  await page.evaluate(({ data, SIZE_MAP, ALIGNMENT_MAP, CR_MAP, HIT_DIE_MAP }) => {
    // Native setter bypasses overlay issues and properly triggers form state
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;

    const setInput = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      inputSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const setSelect = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el) return;
      selectSetter.call(el, value);
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
        selectSetter.call(typeField, "6");
        typeField.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Set the plain textarea
      const textarea = document.getElementById(`field-${baseName}`) as HTMLTextAreaElement | null;
      if (textarea) {
        textareaSetter.call(textarea, html);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Also set wysiwyg textarea and TinyMCE editor
      const wysiwygTextarea = document.getElementById(`field-${baseName}-wysiwyg`) as HTMLTextAreaElement | null;
      if (wysiwygTextarea) {
        textareaSetter.call(wysiwygTextarea, html);
      }
      if (typeof (window as any).tinymce !== "undefined") {
        const editor = (window as any).tinymce.get(`field-${baseName}-wysiwyg`);
        if (editor) editor.setContent(html);
      }
    };

    // ── Basic Fields ───────────────────────────────────────────────────
    if (data.name !== undefined) setInput("field-Name", data.name);
    if (data.size !== undefined) setSelect("field-size", SIZE_MAP[data.size] ?? "");
    if (data.alignment !== undefined) setSelect("field-alignment", ALIGNMENT_MAP[data.alignment] ?? "");
    if (data.ac !== undefined) setInput("field-armor-class", data.ac);
    if (data.ac_type !== undefined) setInput("field-armor-class-type", data.ac_type);
    if (data.hp !== undefined) setInput("field-average-hit-points", data.hp);
    if (data.passive_perception !== undefined) setInput("field-passive-perception", data.passive_perception);

    // ── Challenge Rating ───────────────────────────────────────────────
    if (data.challenge !== undefined) {
      // Extract CR value from strings like "5 (1,800 XP)" or just "5"
      const crNum = data.challenge.match(/^([\d/]+)/)?.[1] ?? data.challenge;
      const crValue = CR_MAP[crNum];
      if (crValue) setSelect("field-challenge-rating", crValue);
    }

    // ── Hit Dice ───────────────────────────────────────────────────────
    if (data.hit_dice !== undefined) {
      const hdMatch = data.hit_dice.match(/(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?/);
      if (hdMatch) {
        setInput("field-hit-points-die-count", hdMatch[1]);
        setSelect("field-hit-points-die-value", hdMatch[2]);
        const sign = hdMatch[3] === "-" ? "-" : "";
        setInput("field-hit-points-modifier", sign + (hdMatch[4] ?? "0"));
      }
    }

    // ── Monster Type ───────────────────────────────────────────────────
    if (data.type !== undefined) {
      // Match by option text since we don't have a hardcoded type map
      const typeSelect = document.getElementById("field-monster-type") as HTMLSelectElement | null;
      if (typeSelect) {
        const option = Array.from(typeSelect.options).find(
          o => o.text.toLowerCase() === data.type!.toLowerCase()
        );
        if (option) {
          selectSetter.call(typeSelect, option.value);
          typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }

    // ── Ability Scores ─────────────────────────────────────────────────
    if (data.abilities) {
      const abilityFieldMap: Record<string, string> = {
        STR: "strength", DEX: "dexterity", CON: "constitution",
        INT: "intelligence", WIS: "wisdom", CHA: "charisma",
      };
      for (const [key, val] of Object.entries(data.abilities)) {
        const fieldName = abilityFieldMap[key];
        if (!fieldName) continue;
        setInput(`field-${fieldName}`, String(val.score));
        if (val.save !== undefined) {
          setInput(`field-${fieldName}-save-bonus`, val.save);
        }
      }
    }

    // ── Checkboxes for legendary/mythic/lair ───────────────────────────
    if (data.legendary_actions !== undefined) {
      setCheckbox("field-is-legendary", data.legendary_actions.length > 0);
    }
    if (data.mythic_actions !== undefined) {
      setCheckbox("field-is-mythic", data.mythic_actions.length > 0);
    }
    if (data.lair !== undefined) {
      setCheckbox("field-has-lair", data.lair.length > 0);
    }

    // ── HTML Description Fields ────────────────────────────────────────
    // Helper to convert action arrays to HTML
    const toHtml = (entries: Array<{name: string; description: string}>) =>
      entries.map(e =>
        e.name === "_intro"
          ? `<p>${e.description}</p>`
          : `<p><em><strong>${e.name}.</strong></em> ${e.description}</p>`
      ).join("\n");

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
    HIT_DIE_MAP,
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/homebrew.ts
git commit -m "feat: add fillMonsterForm function for monster form automation"
```

### Task 3: Implement `editMonster`

**Files:**
- Modify: `src/tools/homebrew.ts`

- [ ] **Step 1: Add the `editMonster` export function**

```typescript
/**
 * Edit an existing homebrew monster on D&D Beyond.
 * @param id Monster ID from URL (e.g. "6287523-shadow-warden")
 * @param data Fields to update — only provided fields are changed
 */
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

  // Verify we're on the edit form
  const hasForm = await page.evaluate(() => !!document.getElementById("monster-form"));
  if (!hasForm) {
    throw new Error(`Monster form not found at ${editUrl}. Check the monster ID.`);
  }

  await fillMonsterForm(page, data);

  // Submit
  await dismissOverlays(page);
  await page.evaluate(() => {
    document.getElementById("monster-form")?.submit();
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/homebrew.ts
git commit -m "feat: add editMonster function"
```

### Task 4: Register `ddb_edit_monster` in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import and tool registration**

Add to imports at top of `src/index.ts`:
```typescript
import { editMonster } from "./tools/homebrew.js";
```

Add tool registration before the `// ─── Start server` section:
```typescript
// ─── ddb_edit_monster ────────────────────────────────────────────────────────
server.tool(
  "ddb_edit_monster",
  "Edit an existing homebrew monster on D&D Beyond. Accepts structured JSON matching ddb_get_monster output. Only provided fields are updated.",
  {
    id: z.string().describe("Monster ID from URL (e.g. '6287523-shadow-warden')"),
    data: z.object({
      name: z.string().optional(),
      size: z.string().optional().describe("Tiny, Small, Medium, Large, Huge, Gargantuan"),
      type: z.string().optional().describe("Aberration, Beast, Celestial, etc."),
      alignment: z.string().optional().describe("Chaotic Evil, Neutral Good, etc."),
      ac: z.string().optional().describe("Armor class number"),
      ac_type: z.string().optional().describe("e.g. 'natural armor'"),
      hp: z.string().optional().describe("Average hit points"),
      hit_dice: z.string().optional().describe("e.g. '20d8 + 140'"),
      passive_perception: z.string().optional(),
      challenge: z.string().optional().describe("CR value: '0', '1/4', '1/2', '1'-'30'"),
      abilities: z.record(z.object({
        score: z.number(),
        save: z.string().optional(),
      })).optional().describe("Keyed by STR/DEX/CON/INT/WIS/CHA"),
      traits: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      bonus_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      reactions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      legendary_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      mythic_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      lair: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      lore: z.string().optional(),
    }).describe("Fields to update (only provided fields are changed)"),
  },
  async ({ id, data }) => {
    try {
      const context = await getSharedContext();
      const result = await editMonster(context, id, data);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to edit monster: ${msg}` }], isError: true };
    }
  }
);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts src/tools/homebrew.ts
git commit -m "feat: register ddb_edit_monster tool"
```

### Task 5: Build and test `ddb_edit_monster`

- [ ] **Step 1: Build**

Run: `cd /Users/csinger/projects/ddb-mcp && npm run build`
Expected: Clean build, `dist/` updated

- [ ] **Step 2: Manual test via Claude Code**

Restart Claude Code MCP, then test:
1. `ddb_get_monster` with source "my-creations" for "Shadow Warden" — note the current HP
2. `ddb_edit_monster` with id "6287523-shadow-warden" and `{ "hp": "90", "hit_dice": "12d10 + 24" }`
3. `ddb_get_monster` with source "my-creations" for "Shadow Warden" — verify HP changed

- [ ] **Step 3: Commit if any fixes needed**

---

## Chunk 2: Create Monster

### Task 6: Implement `createMonster`

**Files:**
- Modify: `src/tools/homebrew.ts`

- [ ] **Step 1: Add the `createMonster` export function**

```typescript
/**
 * Create a new homebrew monster on D&D Beyond.
 * Navigates to the create page, fills in all provided fields, and submits.
 * @returns JSON with the new monster's URL and ID
 */
export async function createMonster(
  context: BrowserContext,
  data: MonsterData
): Promise<string> {
  if (!data.name) throw new Error("Monster name is required for creation.");

  const page = await getPage(context);

  // Navigate to create page
  await page.goto("https://www.dndbeyond.com/homebrew/creations/create-monster/create", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  await dismissOverlays(page);

  // Verify form loaded
  const hasForm = await page.evaluate(() => !!document.getElementById("monster-form"));
  if (!hasForm) {
    // May need to click "CREATE FROM SCRATCH" first
    try {
      await page.locator('a:has-text("CREATE FROM SCRATCH"), a:has-text("Create from Scratch")').first().click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      await dismissOverlays(page);
    } catch {
      throw new Error("Monster create form not found. Navigation may have failed.");
    }
  }

  await fillMonsterForm(page, data);

  // Submit
  await dismissOverlays(page);
  await page.evaluate(() => {
    document.getElementById("monster-form")?.submit();
  });

  await page.waitForTimeout(8000);
  const finalUrl = page.url();

  // Extract monster ID from the redirect URL
  // Format: /homebrew/creations/monsters/{id}-{slug}/edit
  const idMatch = finalUrl.match(/\/monsters\/(\d+-[^/]+)\/edit/);
  const newId = idMatch?.[1] ?? "";

  return JSON.stringify({
    status: "created",
    url: finalUrl,
    id: newId,
    name: data.name,
  }, null, 2);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/homebrew.ts
git commit -m "feat: add createMonster function"
```

### Task 7: Register `ddb_create_monster` in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update import and add tool registration**

Update import:
```typescript
import { editMonster, createMonster } from "./tools/homebrew.js";
```

Add registration:
```typescript
// ─── ddb_create_monster ──────────────────────────────────────────────────────
server.tool(
  "ddb_create_monster",
  "Create a new homebrew monster on D&D Beyond. Accepts structured JSON matching ddb_get_monster output format. Name is required.",
  {
    data: z.object({
      name: z.string().describe("Monster name (required)"),
      size: z.string().optional().describe("Tiny, Small, Medium, Large, Huge, Gargantuan"),
      type: z.string().optional().describe("Aberration, Beast, Celestial, etc."),
      alignment: z.string().optional(),
      ac: z.string().optional(),
      ac_type: z.string().optional(),
      hp: z.string().optional(),
      hit_dice: z.string().optional().describe("e.g. '20d8 + 140'"),
      passive_perception: z.string().optional(),
      challenge: z.string().optional().describe("CR value: '0', '1/4', '1/2', '1'-'30'"),
      abilities: z.record(z.object({
        score: z.number(),
        save: z.string().optional(),
      })).optional().describe("Keyed by STR/DEX/CON/INT/WIS/CHA"),
      traits: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      bonus_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      reactions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      legendary_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      mythic_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      lair: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
      lore: z.string().optional(),
    }).describe("Monster data — name is required, all other fields optional"),
  },
  async ({ data }) => {
    try {
      const context = await getSharedContext();
      const result = await createMonster(context, data);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to create monster: ${msg}` }], isError: true };
    }
  }
);
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/csinger/projects/ddb-mcp && npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/index.ts src/tools/homebrew.ts
git commit -m "feat: register ddb_create_monster tool"
```

### Task 8: Manual test `ddb_create_monster`

- [ ] **Step 1: Restart MCP and test**

1. `ddb_create_monster` with:
```json
{
  "data": {
    "name": "Test Goblin",
    "size": "Small",
    "type": "Humanoid",
    "alignment": "Neutral Evil",
    "ac": "15",
    "ac_type": "leather armor, shield",
    "hp": "7",
    "hit_dice": "2d6",
    "challenge": "1/4",
    "abilities": {
      "STR": { "score": 8 },
      "DEX": { "score": 14 },
      "CON": { "score": 10 },
      "INT": { "score": 10 },
      "WIS": { "score": 8 },
      "CHA": { "score": 8 }
    },
    "actions": [
      { "name": "Scimitar", "description": "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage." }
    ]
  }
}
```
2. Use returned ID to `ddb_get_monster` with source "my-creations" — verify fields
3. Delete the test monster manually via DDB

---

## Chunk 3: Item CRUD

### Task 9: Inspect item form fields

**Files:**
- Modify: `src/tools/homebrew.ts`

The item form structure wasn't fully captured during design. We need to inspect it first.

- [ ] **Step 1: Add a temporary inspection script to discover item form fields**

Run a Playwright script (via node) that navigates to a homebrew item edit page and dumps all form field IDs:

```bash
cd /Users/csinger/projects/ddb-mcp && NODE_PATH=./node_modules node -e "
const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const path = require('path');
(async () => {
  const sessionPath = path.join(require('os').homedir(), '.config/ddb-mcp/session.json');
  const storageState = JSON.parse(readFileSync(sessionPath, 'utf-8'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto('https://www.dndbeyond.com/homebrew/creations/create-magic-item/create', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await page.waitForTimeout(5000);
  const fields = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[id^=\"field-\"]')).map(el => ({
      id: el.id,
      tag: el.tagName,
      type: (el as any).type || '',
      options: el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map(o => o.value + ':' + o.text) : undefined,
    }));
  });
  console.log(JSON.stringify(fields, null, 2));
  await browser.close();
})();
"
```

Record the discovered field IDs and option values.

- [ ] **Step 2: Implement `fillItemForm` and item value maps**

Based on discovered fields, add to `src/tools/homebrew.ts`:
```typescript
// Item-specific value maps (populate after field inspection)
const ITEM_RARITY_MAP: Record<string, string> = {
  // Populated from inspection results
};

async function fillItemForm(page: import("playwright").Page, data: ItemData): Promise<void> {
  await page.evaluate(({ data, ITEM_RARITY_MAP }) => {
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;

    const setInput = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      inputSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const setSelect = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el) return;
      selectSetter.call(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const setDescription = (baseName: string, html: string) => {
      const typeField = document.getElementById(`field-${baseName}-type`) as HTMLSelectElement | null;
      if (typeField) {
        selectSetter.call(typeField, "6");
        typeField.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const textarea = document.getElementById(`field-${baseName}`) as HTMLTextAreaElement | null;
      if (textarea) {
        textareaSetter.call(textarea, html);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const wysiwygTextarea = document.getElementById(`field-${baseName}-wysiwyg`) as HTMLTextAreaElement | null;
      if (wysiwygTextarea) textareaSetter.call(wysiwygTextarea, html);
      if (typeof (window as any).tinymce !== "undefined") {
        const editor = (window as any).tinymce.get(`field-${baseName}-wysiwyg`);
        if (editor) editor.setContent(html);
      }
    };

    if (data.name !== undefined) setInput("field-Name", data.name);
    if (data.rarity !== undefined) {
      const rarityValue = ITEM_RARITY_MAP[data.rarity];
      if (rarityValue) setSelect("field-rarity", rarityValue);
    }
    // Item type — match by option text
    if (data.type !== undefined) {
      const typeSelect = document.getElementById("field-item-type") as HTMLSelectElement | null;
      if (typeSelect) {
        const option = Array.from(typeSelect.options).find(
          o => o.text.toLowerCase().includes(data.type!.toLowerCase())
        );
        if (option) {
          selectSetter.call(typeSelect, option.value);
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
    // Description
    if (data.description !== undefined) {
      setDescription("description", data.description);
    }
  }, { data: data as any, ITEM_RARITY_MAP });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/tools/homebrew.ts
git commit -m "feat: add fillItemForm function for item form automation"
```

### Task 10: Implement `editItem` and `createItem`

**Files:**
- Modify: `src/tools/homebrew.ts`

- [ ] **Step 1: Add `editItem` function**

```typescript
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

  // Find the item form — may be "magic-item-form" or similar
  const formId = await page.evaluate(() => {
    const form = document.querySelector("form[id*='item'], form[id*='magic']") as HTMLFormElement | null;
    return form?.id ?? null;
  });
  if (!formId) throw new Error(`Item form not found at ${editUrl}. Check the item ID.`);

  await fillItemForm(page, data);

  await dismissOverlays(page);
  await page.evaluate((fid: string) => {
    document.getElementById(fid)?.submit();
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
```

- [ ] **Step 2: Add `createItem` function**

```typescript
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

  // May need to click "CREATE FROM SCRATCH"
  const hasForm = await page.evaluate(() =>
    !!document.querySelector("form[id*='item'], form[id*='magic']")
  );
  if (!hasForm) {
    try {
      await page.locator('a:has-text("CREATE FROM SCRATCH"), a:has-text("Create from Scratch")').first().click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      await dismissOverlays(page);
    } catch {
      throw new Error("Item create form not found.");
    }
  }

  await fillItemForm(page, data);

  await dismissOverlays(page);
  const formId = await page.evaluate(() => {
    const form = document.querySelector("form[id*='item'], form[id*='magic']") as HTMLFormElement | null;
    return form?.id ?? null;
  });
  if (formId) {
    await page.evaluate((fid: string) => {
      document.getElementById(fid)?.submit();
    }, formId);
  }

  await page.waitForTimeout(8000);
  const finalUrl = page.url();

  const idMatch = finalUrl.match(/\/magic-items\/(\d+-[^/]+)\/edit/);
  const newId = idMatch?.[1] ?? "";

  return JSON.stringify({
    status: "created",
    url: finalUrl,
    id: newId,
    name: data.name,
  }, null, 2);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/tools/homebrew.ts
git commit -m "feat: add editItem and createItem functions"
```

### Task 11: Register `ddb_edit_item` and `ddb_create_item` in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update import and add registrations**

Update import:
```typescript
import { editMonster, createMonster, editItem, createItem } from "./tools/homebrew.js";
```

Add registrations:
```typescript
// ─── ddb_edit_item ───────────────────────────────────────────────────────────
server.tool(
  "ddb_edit_item",
  "Edit an existing homebrew magic item on D&D Beyond.",
  {
    id: z.string().describe("Item ID from URL (e.g. '2399135-buster-sword')"),
    data: z.object({
      name: z.string().optional(),
      type: z.string().optional(),
      rarity: z.string().optional().describe("Common, Uncommon, Rare, Very Rare, Legendary, Artifact"),
      attunement: z.boolean().optional(),
      attunement_description: z.string().optional(),
      description: z.string().optional().describe("Item description (HTML or plain text)"),
    }).describe("Fields to update"),
  },
  async ({ id, data }) => {
    try {
      const context = await getSharedContext();
      const result = await editItem(context, id, data);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to edit item: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_create_item ─────────────────────────────────────────────────────────
server.tool(
  "ddb_create_item",
  "Create a new homebrew magic item on D&D Beyond.",
  {
    data: z.object({
      name: z.string().describe("Item name (required)"),
      type: z.string().optional(),
      rarity: z.string().optional().describe("Common, Uncommon, Rare, Very Rare, Legendary, Artifact"),
      attunement: z.boolean().optional(),
      attunement_description: z.string().optional(),
      description: z.string().optional().describe("Item description (HTML or plain text)"),
    }).describe("Item data — name is required"),
  },
  async ({ data }) => {
    try {
      const context = await getSharedContext();
      const result = await createItem(context, data);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to create item: ${msg}` }], isError: true };
    }
  }
);
```

- [ ] **Step 2: Build**

Run: `cd /Users/csinger/projects/ddb-mcp && npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: register ddb_edit_item and ddb_create_item tools"
```

### Task 12: Manual test item tools

- [ ] **Step 1: Restart MCP and test create**

1. `ddb_create_item` with:
```json
{
  "data": {
    "name": "Test Amulet",
    "rarity": "Uncommon",
    "attunement": true,
    "description": "<p>While wearing this amulet, you gain a +1 bonus to AC.</p>"
  }
}
```
2. Verify creation via returned URL
3. `ddb_edit_item` to change name to "Test Amulet of Protection"
4. Verify edit took effect
5. Delete test item manually

---

## Chunk 4: Build and Final Verification

### Task 13: Full build and integration test

- [ ] **Step 1: Clean build**

Run: `cd /Users/csinger/projects/ddb-mcp && rm -rf dist && npm run build`
Expected: Clean build with no errors

- [ ] **Step 2: Type check**

Run: `cd /Users/csinger/projects/ddb-mcp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: End-to-end test — create → read → edit → read → cleanup**

1. Create a test monster via `ddb_create_monster`
2. Read it back via `ddb_get_monster` (source: my-creations) — verify fields
3. Edit it via `ddb_edit_monster` — change HP and add a reaction
4. Read it back again — verify changes
5. Delete test monster via DDB UI

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: add homebrew CRUD tools (create/edit monster and item)"
```
