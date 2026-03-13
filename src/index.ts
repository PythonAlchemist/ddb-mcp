import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getBrowser, getContext } from "./browser.js";
import { login } from "./auth.js";
import { getCharacter, downloadCharacter, scrapeCharacterSheet, listCharacters } from "./tools/character.js";
import { getCampaign, listMyCampaigns } from "./tools/campaign.js";
import { navigate, interact, getCurrentPageContent, downloadImage } from "./tools/navigate.js";
import { search } from "./tools/search.js";
import { getMonster, getSpell, getItem, getFeat, getRace, getClass, getBackground, getCondition, getRule, getEquipment, listMyCreations } from "./tools/compendium.js";
import type { CompendiumSource } from "./tools/compendium.js";
import { editMonster, createMonster, editItem, createItem, deleteHomebrew } from "./tools/homebrew.js";
import { listLibrary, readBook } from "./tools/library.js";

const server = new McpServer({
  name: "dndbeyond",
  version: "1.0.0",
});

// Lazy-initialized shared browser context
async function getSharedContext() {
  const browser = await getBrowser();
  const context = await getContext(browser);
  return context;
}

// ─── ddb_login ────────────────────────────────────────────────────────────────
server.tool(
  "ddb_login",
  "Launch a browser and log into D&D Beyond via Google OAuth. Run this once to save your session to disk. Subsequent tool calls restore the session automatically.",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const result = await login(context);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Login failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_list_characters ──────────────────────────────────────────────────────
server.tool(
  "ddb_list_characters",
  "List all characters in your D&D Beyond account, including their ID, level, race, and class.",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const result = await listCharacters(context);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list characters: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_character ────────────────────────────────────────────────────────
server.tool(
  "ddb_get_character",
  "Fetch full character data JSON from the D&D Beyond character service API. Requires character ID (the number in the character URL).",
  {
    character_id: z.string().describe("The D&D Beyond character ID (e.g. '12345678')"),
    fallback_scrape: z
      .boolean()
      .optional()
      .describe("If true, fall back to scraping the rendered character sheet HTML if the API fails"),
  },
  async ({ character_id, fallback_scrape }) => {
    try {
      const context = await getSharedContext();
      const data = await getCharacter(context, character_id);
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      if (fallback_scrape) {
        try {
          const context = await getSharedContext();
          const scraped = await scrapeCharacterSheet(context, character_id);
          return { content: [{ type: "text", text: scraped }] };
        } catch (scrapeErr) {
          const msg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
          return { content: [{ type: "text", text: `API and scrape both failed: ${msg}` }], isError: true };
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get character: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_download_character ───────────────────────────────────────────────────
server.tool(
  "ddb_download_character",
  "Download a character's full JSON data to a local file.",
  {
    character_id: z.string().describe("The D&D Beyond character ID"),
    output_path: z
      .string()
      .optional()
      .describe("Full file path to save to (defaults to ~/Downloads/{name}-{id}.json)"),
  },
  async ({ character_id, output_path }) => {
    try {
      const context = await getSharedContext();
      const result = await downloadCharacter(context, character_id, output_path);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Download failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_campaign ─────────────────────────────────────────────────────────
server.tool(
  "ddb_get_campaign",
  "Fetch campaign information including player characters, notes, and description from a D&D Beyond campaign page.",
  {
    campaign_id: z.string().describe("The D&D Beyond campaign ID (found in the campaign URL)"),
  },
  async ({ campaign_id }) => {
    try {
      const context = await getSharedContext();
      const data = await getCampaign(context, campaign_id);
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get campaign: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_list_campaigns ───────────────────────────────────────────────────────
server.tool(
  "ddb_list_campaigns",
  "List all D&D Beyond campaigns you are part of (as DM or player).",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const data = await listMyCampaigns(context);
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list campaigns: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_navigate ─────────────────────────────────────────────────────────────
server.tool(
  "ddb_navigate",
  "Navigate to any D&D Beyond URL and return the page's text content. Only dndbeyond.com URLs are allowed.",
  {
    url: z
      .string()
      .describe("Full D&D Beyond URL to navigate to (must start with https://www.dndbeyond.com/)"),
  },
  async ({ url }) => {
    try {
      const context = await getSharedContext();
      const content = await navigate(context, url);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Navigation failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_interact ─────────────────────────────────────────────────────────────
server.tool(
  "ddb_interact",
  "Interact with the currently loaded D&D Beyond page by clicking, filling a form field, taking a screenshot, or evaluating JavaScript.",
  {
    action: z
      .enum(["click", "fill", "screenshot", "evaluate"])
      .describe("The action to perform: click an element, fill a text field, take a screenshot, or evaluate a JS expression"),
    selector: z.string().describe("CSS selector for click/fill/screenshot, or a JavaScript expression for evaluate"),
    value: z
      .string()
      .optional()
      .describe("Value to type into the field (required for 'fill' action)"),
  },
  async ({ action, selector, value }) => {
    try {
      const context = await getSharedContext();
      const result = await interact(context, action, selector, value);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Interaction failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_download_image ──────────────────────────────────────────────────────
server.tool(
  "ddb_download_image",
  "Download an image from D&D Beyond (maps, illustrations, etc.) to a local file. Uses the authenticated browser session to access protected CDN content.",
  {
    url: z
      .string()
      .describe(
        "The image URL from media.dndbeyond.com (e.g. from ddb_read_book output or page scraping)"
      ),
    output_path: z
      .string()
      .optional()
      .describe(
        "Full file path to save to. If omitted, saves to ~/Downloads/ with the original filename."
      ),
  },
  async ({ url, output_path }) => {
    try {
      const context = await getSharedContext();
      const result = await downloadImage(context, url, output_path);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Image download failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── ddb_current_page ─────────────────────────────────────────────────────────
server.tool(
  "ddb_current_page",
  "Return the text content of the currently loaded page in the browser.",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const content = await getCurrentPageContent(context);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get page content: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_search ───────────────────────────────────────────────────────────────
server.tool(
  "ddb_search",
  "Search D&D Beyond for spells, monsters, magic items, races, classes, or feats.",
  {
    query: z.string().describe("The search query (e.g. 'Fireball', 'Beholder', 'Vorpal Sword')"),
    category: z
      .enum(["spells", "monsters", "items", "races", "classes", "feats", "all"])
      .optional()
      .describe("Category to search within (defaults to 'all')"),
  },
  async ({ query, category }) => {
    try {
      const context = await getSharedContext();
      const results = await search(context, query, category ?? "all");
      return { content: [{ type: "text", text: results }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Search failed: ${msg}` }], isError: true };
    }
  }
);

// Shared source param for compendium tools
const sourceParam = z
  .enum(["official", "homebrew", "my-creations"])
  .optional()
  .describe("Where to search: 'official' (default), 'homebrew' (community), or 'my-creations' (your own)");

// ─── ddb_get_monster ─────────────────────────────────────────────────────────
server.tool(
  "ddb_get_monster",
  "Look up a monster on D&D Beyond and return structured stat block data (AC, HP, abilities, actions, etc.).",
  {
    query: z.string().describe("Monster name to search for (e.g. 'Hook Horror', 'Beholder', 'Adult Red Dragon')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getMonster(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get monster: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_spell ──────────────────────────────────────────────────────────
server.tool(
  "ddb_get_spell",
  "Look up a spell on D&D Beyond and return structured data (level, school, components, description, etc.).",
  {
    query: z.string().describe("Spell name to search for (e.g. 'Fireball', 'Arms of Hadar', 'Shield')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getSpell(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get spell: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_item ───────────────────────────────────────────────────────────
server.tool(
  "ddb_get_item",
  "Look up a magic item on D&D Beyond and return structured data (type, rarity, attunement, description, etc.).",
  {
    query: z.string().describe("Magic item name to search for (e.g. 'Wand of Magic Missiles', 'Vorpal Sword')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getItem(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get item: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_feat ───────────────────────────────────────────────────────────
server.tool(
  "ddb_get_feat",
  "Look up a feat on D&D Beyond and return structured data (prerequisite, description, etc.).",
  {
    query: z.string().describe("Feat name to search for (e.g. 'Great Weapon Master', 'Sharpshooter', 'Lucky')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getFeat(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get feat: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_race ───────────────────────────────────────────────────────────
server.tool(
  "ddb_get_race",
  "Look up a race/species on D&D Beyond and return structured data (traits, ability scores, speed, etc.).",
  {
    query: z.string().describe("Race or species name to search for (e.g. 'Half-Elf', 'Dragonborn', 'Tiefling')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getRace(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get race: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_class ──────────────────────────────────────────────────────────
server.tool(
  "ddb_get_class",
  "Look up a class on D&D Beyond and return structured data (hit die, proficiencies, features, subclasses, etc.).",
  {
    query: z.string().describe("Class name to search for (e.g. 'Ranger', 'Warlock', 'Paladin')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getClass(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get class: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_background ─────────────────────────────────────────────────────
server.tool(
  "ddb_get_background",
  "Look up a background on D&D Beyond and return structured data (skill proficiencies, equipment, features, etc.).",
  {
    query: z.string().describe("Background name to search for (e.g. 'Acolyte', 'Criminal', 'Noble')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getBackground(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get background: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_condition ──────────────────────────────────────────────────────
server.tool(
  "ddb_get_condition",
  "Look up a condition (Blinded, Frightened, Stunned, Exhaustion, etc.) from the D&D free rules glossary.",
  {
    query: z.string().describe("Condition name (e.g. 'Blinded', 'Frightened', 'Prone', 'Exhaustion')"),
  },
  async ({ query }) => {
    try {
      const context = await getSharedContext();
      const result = await getCondition(context, query);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get condition: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_rule ───────────────────────────────────────────────────────────
server.tool(
  "ddb_get_rule",
  "Look up a game rule from the D&D free rules (grappling, cover, opportunity attacks, long rest, etc.). Searches the rules glossary and core rule chapters.",
  {
    query: z.string().describe("Rule name or topic to search for (e.g. 'Grapple', 'Cover', 'Opportunity Attack', 'Long Rest')"),
  },
  async ({ query }) => {
    try {
      const context = await getSharedContext();
      const result = await getRule(context, query);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get rule: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_equipment ──────────────────────────────────────────────────────
server.tool(
  "ddb_get_equipment",
  "Look up mundane equipment (weapons, armor, adventuring gear, tools) on D&D Beyond. For magic items, use ddb_get_item instead.",
  {
    query: z.string().describe("Equipment name to search for (e.g. 'Longsword', 'Chain Mail', 'Thieves Tools')"),
    source: sourceParam,
  },
  async ({ query, source }) => {
    try {
      const context = await getSharedContext();
      const result = await getEquipment(context, query, (source ?? "official") as CompendiumSource);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get equipment: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_list_my_creations ──────────────────────────────────────────────────
server.tool(
  "ddb_list_my_creations",
  "List all your homebrew creations on D&D Beyond (monsters, items, spells, etc. from /my-creations).",
  {
    type: z
      .string()
      .optional()
      .describe("Filter by type: 'monster', 'item', 'spell', 'feat', 'background', 'class', 'subclass', or omit for all"),
  },
  async ({ type }) => {
    try {
      const context = await getSharedContext();
      const result = await listMyCreations(context, type);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list creations: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_list_library ─────────────────────────────────────────────────────────
server.tool(
  "ddb_list_library",
  "List all books you own in your D&D Beyond library, including sourcebooks, adventures, and supplements.",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const books = await listLibrary(context);
      return { content: [{ type: "text", text: books }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list library: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_read_book ────────────────────────────────────────────────────────────
server.tool(
  "ddb_read_book",
  "Read content from an owned D&D Beyond sourcebook. Provide the book slug (e.g. 'players-handbook') and optionally a chapter slug.",
  {
    book_slug: z
      .string()
      .describe("The book slug from the D&D Beyond URL (e.g. 'players-handbook', 'dungeon-masters-guide')"),
    chapter_slug: z
      .string()
      .optional()
      .describe(
        "Optional chapter or section slug (e.g. 'classes/ranger'). If omitted, returns the book's table of contents."
      ),
  },
  async ({ book_slug, chapter_slug }) => {
    try {
      const context = await getSharedContext();
      const content = await readBook(context, book_slug, chapter_slug);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to read book: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_edit_monster ────────────────────────────────────────────────────────
const actionEntrySchema = z.object({ name: z.string(), description: z.string() });

server.tool(
  "ddb_edit_monster",
  "Edit an existing homebrew monster on D&D Beyond. Accepts structured JSON matching ddb_get_monster output. Only provided fields are updated.",
  {
    id: z.string().describe("Monster ID from URL (e.g. '6287523-shadow-warden')"),
    data: z.object({
      name: z.string().optional(),
      size: z.string().optional().describe("Tiny, Small, Medium, Large, Huge, Gargantuan"),
      type: z.string().optional().describe("Aberration, Beast, Celestial, etc."),
      alignment: z.string().optional(),
      ac: z.string().optional(),
      ac_type: z.string().optional(),
      hp: z.string().optional(),
      hit_dice: z.string().optional().describe("e.g. '20d8 + 140'"),
      passive_perception: z.string().optional(),
      challenge: z.string().optional().describe("CR value: '0', '1/4', '1/2', '1'-'30'"),
      abilities: z.record(z.string(), z.object({
        score: z.number(),
        save: z.string().optional(),
      })).optional().describe("Keyed by STR/DEX/CON/INT/WIS/CHA"),
      traits: z.array(actionEntrySchema).optional(),
      actions: z.array(actionEntrySchema).optional(),
      bonus_actions: z.array(actionEntrySchema).optional(),
      reactions: z.array(actionEntrySchema).optional(),
      legendary_actions: z.array(actionEntrySchema).optional(),
      mythic_actions: z.array(actionEntrySchema).optional(),
      lair: z.array(actionEntrySchema).optional(),
      lore: z.string().optional(),
    }).describe("Fields to update (only provided fields are changed)"),
  },
  async ({ id, data }) => {
    try {
      const context = await getSharedContext();
      const result = await editMonster(context, id, data as any);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to edit monster: ${msg}` }], isError: true };
    }
  }
);

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
      abilities: z.record(z.string(), z.object({
        score: z.number(),
        save: z.string().optional(),
      })).optional().describe("Keyed by STR/DEX/CON/INT/WIS/CHA"),
      traits: z.array(actionEntrySchema).optional(),
      actions: z.array(actionEntrySchema).optional(),
      bonus_actions: z.array(actionEntrySchema).optional(),
      reactions: z.array(actionEntrySchema).optional(),
      legendary_actions: z.array(actionEntrySchema).optional(),
      mythic_actions: z.array(actionEntrySchema).optional(),
      lair: z.array(actionEntrySchema).optional(),
      lore: z.string().optional(),
    }).describe("Monster data — name is required, all other fields optional"),
  },
  async ({ data }) => {
    try {
      const context = await getSharedContext();
      const result = await createMonster(context, data as any);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to create monster: ${msg}` }], isError: true };
    }
  }
);

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

// ─── ddb_delete_homebrew ──────────────────────────────────────────────────────
server.tool(
  "ddb_delete_homebrew",
  "Delete a homebrew monster or magic item from D&D Beyond. This is permanent and cannot be undone.",
  {
    type: z.enum(["monster", "item"]).describe("Type of creation to delete"),
    id: z.string().describe("Creation ID from URL (e.g. '6287636-test-goblin-boss')"),
  },
  async ({ type, id }) => {
    try {
      const context = await getSharedContext();
      const result = await deleteHomebrew(context, type, id);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to delete: ${msg}` }], isError: true };
    }
  }
);

// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("D&D Beyond MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
