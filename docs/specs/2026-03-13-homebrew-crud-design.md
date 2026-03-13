# Homebrew CRUD Tools — Design Spec

## Overview

Add tools to create and edit homebrew monsters and items on D&D Beyond through browser form automation. The tools accept structured JSON (matching the output format of `ddb_get_monster` / `ddb_get_item`) and translate it into DDB's homebrew form fields.

## Content Types (Phase 1)

- **Monsters**: `ddb_edit_monster`, `ddb_create_monster`
- **Items**: `ddb_edit_item`, `ddb_create_item`

Future phases can add spells, feats, backgrounds, etc. using the same patterns.

## URL Patterns

| Action | URL |
|--------|-----|
| Monster edit | `/homebrew/creations/monsters/{id}-{slug}/edit` |
| Monster create | `/homebrew/creations/monsters/create` |
| Item edit | `/homebrew/creations/magic-items/{id}-{slug}/edit` |
| Item create | `/homebrew/creations/magic-items/create` |

## Architecture

### New file: `src/tools/homebrew.ts`

All CRUD functions live here. Imports `getPage` from `browser.ts` and uses form automation via Playwright.

### Approach: Form Automation via `#field-*` Selectors

DDB's homebrew forms use stable `id` attributes on all fields (`field-Name`, `field-strength`, etc.) even though `name` attributes are obfuscated (anti-bot). We target fields by `id`.

The forms are `POST multipart/form-data` to the same URL. Save is triggered by clicking `button[type="submit"]` inside the main form.

### Input Format: Structured JSON → Form Fields

Tools accept the same structured format that `getMonster`/`getItem` return, so you can round-trip: read → modify → write back.

## Monster Fields Mapping

### Basic Fields (text/select → `page.fill()` or `page.selectOption()`)

| Input Key | Form Field ID | Type | Notes |
|-----------|--------------|------|-------|
| `name` | `field-Name` | text | Required |
| `version` | `field-version` | text | e.g. "1", "1.5" |
| `size` | `field-size` | select | Map text → value (Tiny=2, Small=3, Medium=4, Large=5, Huge=6, Gargantuan=7) |
| `type` | `field-monster-type` | select | Map text → value (lookup needed) |
| `alignment` | `field-alignment` | select | Map text → value |
| `challenge` | `field-challenge-rating` | select | Map CR string → value |
| `ac` | `field-armor-class` | text | Numeric part only |
| `ac_type` | `field-armor-class-type` | text | e.g. "(natural armor)" |
| `hp` | `field-average-hit-points` | text | |
| `hit_dice_count` | `field-hit-points-die-count` | text | e.g. "20" from "20d8 + 140" |
| `hit_dice_value` | `field-hit-points-die-value` | select | e.g. "8" for d8 |
| `hit_dice_modifier` | `field-hit-points-modifier` | text | e.g. "140" |
| `passive_perception` | `field-passive-perception` | text | |

### Ability Scores (text via `#field-*` id)

| Input Key | Form Field ID |
|-----------|--------------|
| `abilities.STR.score` | `field-strength` |
| `abilities.DEX.score` | `field-dexterity` |
| `abilities.CON.score` | `field-constitution` |
| `abilities.INT.score` | `field-intelligence` |
| `abilities.WIS.score` | `field-wisdom` |
| `abilities.CHA.score` | `field-charisma` |

### Save Bonuses (text via `#field-*` id)

| Input Key | Form Field ID |
|-----------|--------------|
| `abilities.STR.save` | `field-strength-save-bonus` |
| `abilities.DEX.save` | `field-dexterity-save-bonus` |
| ... | ... |

Note: Save bonus fields expect the total bonus value (e.g. "+11"), not the delta from the ability modifier.

### HTML Description Fields

These fields contain the full text of traits, actions, etc. formatted as HTML:

| Input Key | Form Field ID |
|-----------|--------------|
| `traits` | `field-special-traits-description` |
| `actions` | `field-actions-description` |
| `bonus_actions` | `field-bonus-actions-description` |
| `reactions` | `field-reactions-description` |
| `legendary_actions` | `field-legendary-actions-description` |
| `mythic_actions` | `field-mythic-actions-description` |
| `lore` | `field-monster-characteristics-description` |
| `lair` | `field-lair-description` |

**HTML Format**: Each action entry is:
```html
<p><em><strong>Action Name.</strong></em> Description text here.</p>
```

A helper function converts our structured `[{name, description}]` array into this HTML.

### Checkboxes

| Input Key | Form Field ID | Notes |
|-----------|--------------|-------|
| `legendary_actions` exists | `field-is-legendary` | Check if legendary actions provided |
| `mythic_actions` exists | `field-is-mythic` | Check if mythic actions provided |
| `lair` exists | `field-has-lair` | Check if lair info provided |

### Multi-select Fields (Select2)

These use Select2 widgets and need special interaction:
- `field-monster-saving-throw` — proficient saves
- `field-damage-adjustment` — resistances/immunities/vulnerabilities
- `field-condition-immunity` — condition immunities
- `field-monster-environments` — habitats

**Approach**: Use `page.evaluate()` to set values via Select2's API (`$('#field-x').val([...]).trigger('change')`), or use the Select2 search input to add items one by one.

**Deferred**: Multi-select fields are complex and less frequently edited. Phase 1 will support the basic fields + HTML descriptions. Multi-select editing can be added later.

### Collapsible Sections (Languages, Senses, Skills, Movement)

These sections have "ADD A LANGUAGE/SENSE/SKILL/MOVEMENT" buttons that open sub-forms. Each entry is added individually.

**Deferred**: Like multi-selects, these are complex UI interactions. Phase 1 focuses on the main form fields. These can be added incrementally.

## Item Fields Mapping

Item forms are simpler. Key fields (to be confirmed during implementation):

| Input Key | Form Field ID | Type |
|-----------|--------------|------|
| `name` | `field-Name` | text |
| `type` | `field-item-type` or similar | select |
| `rarity` | `field-rarity` | select |
| `attunement` | `field-requires-attunement` | checkbox + text |
| `description` | `field-description` | HTML textarea |

The item edit form structure needs to be captured during implementation (the create page's JS didn't render in our inspection).

## Tool Interfaces

### `ddb_edit_monster`

```typescript
{
  id: z.string().describe("Monster ID (from URL, e.g. '3586939-fallen-deva')"),
  data: z.object({
    name: z.string().optional(),
    size: z.string().optional(),        // "Medium", "Large", etc.
    type: z.string().optional(),        // "Celestial", "Fiend", etc.
    alignment: z.string().optional(),   // "Chaotic Evil", etc.
    ac: z.string().optional(),          // "20"
    ac_type: z.string().optional(),     // "(natural armor)"
    hp: z.string().optional(),          // "230"
    hit_dice: z.string().optional(),    // "20d8 + 140" — parsed into count/value/modifier
    abilities: z.record(z.object({
      score: z.number(),
      save: z.string().optional()       // "+11"
    })).optional(),
    traits: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    bonus_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    reactions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    legendary_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    mythic_actions: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    lore: z.string().optional(),
  }).describe("Fields to update (only provided fields are changed)")
}
```

**Behavior**: Only fills fields that are provided in `data`. Leaves other fields untouched.

### `ddb_create_monster`

Same `data` shape but `name` is required. Returns the new monster's URL and ID.

### `ddb_edit_item`

```typescript
{
  id: z.string().describe("Item ID (from URL, e.g. '2399135-buster-sword')"),
  data: z.object({
    name: z.string().optional(),
    type: z.string().optional(),
    rarity: z.string().optional(),
    attunement: z.string().optional(),
    description: z.string().optional(),  // Plain text or HTML
  })
}
```

### `ddb_create_item`

Same shape, `name` required. Returns new item URL and ID.

## Implementation Flow

### Edit Monster

```
1. Navigate to /homebrew/creations/monsters/{id}/edit
2. Wait for #monster-form to appear
3. Dismiss any overlay/modal (.vex-close)
4. For each provided field in data:
   a. Map to form field ID
   b. Fill text inputs, select options, or set textarea HTML
5. Click button[type="submit"] inside #monster-form
6. Wait for navigation/success indicator
7. Return { url, name, status: "saved" }
```

### Create Monster

```
1. Navigate to /homebrew/creations/monsters/create
2. Wait for form to render
3. Fill name + basic required fields
4. Click save/create button
5. Wait for redirect to edit page (DDB redirects after creation)
6. Fill remaining fields (same as edit flow)
7. Click save again
8. Return { url, id, name, status: "created" }
```

## Helpers

### `actionsToHtml(entries: {name, description}[]): string`

Converts structured action arrays to DDB's expected HTML format:
```typescript
entries.map(e =>
  e.name === '_intro'
    ? `<p>${e.description}</p>`
    : `<p><em><strong>${e.name}.</strong></em> ${e.description}</p>`
).join('\n')
```

### `parseHitDice(str: string): {count, value, modifier}`

Parses "20d8 + 140" into `{count: "20", value: "8", modifier: "140"}`.

### Select/Option Value Maps

Lookup tables mapping display text to form option values:
- `SIZE_MAP`: {"Tiny": "2", "Small": "3", "Medium": "4", ...}
- `ALIGNMENT_MAP`: {"Lawful Good": "1", ..., "Chaotic Evil": "9", ...}
- `MONSTER_TYPE_MAP`: {"Aberration": "1", ..., "Celestial": "3", ...}
- `CR_MAP`: {"0": "1", "1/8": "2", ..., "15": "19", ...}

These are scraped once from the form's `<option>` elements and hardcoded.

## Phase 1 Scope

- `ddb_edit_monster`: Basic fields + ability scores + save bonuses + HTML description fields
- `ddb_create_monster`: Create with name + basic fields, then edit to fill details
- `ddb_edit_item`: Basic fields + description (pending form structure confirmation)
- `ddb_create_item`: Create with name, then edit

## Phase 2 (Future)

- Multi-select fields (damage types, conditions, environments)
- Collapsible sections (languages, senses, skills, movement)
- Image upload (avatar)
- Spells, feats, backgrounds create/edit
- Delete tool
