import { getPage } from "../browser.js";
/**
 * Category URL segments used when matching general search results back to a category.
 */
const CATEGORY_URL_SEGMENTS = {
    monsters: ["/monsters/"],
    spells: ["/spells/"],
    "magic-items": ["/magic-items/"],
    feats: ["/feats/"],
    races: ["/species/", "/races/"],
    species: ["/species/", "/races/"],
    classes: ["/classes/"],
    backgrounds: ["/backgrounds/"],
    equipment: ["/equipment/"],
};
/**
 * Category type labels as they appear on the my-creations page.
 */
const MY_CREATIONS_TYPE_MAP = {
    monsters: ["monster"],
    spells: ["spell"],
    "magic-items": ["item"],
    feats: ["feat"],
    races: ["race", "species"],
    species: ["race", "species"],
    classes: ["class", "subclass"],
    backgrounds: ["background"],
    equipment: ["item"],
};
/**
 * Find the first link on the current page whose visible text matches the query.
 * Used for table-style listing pages (my-creations, homebrew, feats, etc).
 */
async function findLinkByText(page, query, urlSegments) {
    return page.evaluate(({ q, segments }) => {
        const normalizedQuery = q.toLowerCase().trim();
        const links = Array.from(document.querySelectorAll("a[href]"));
        for (const link of links) {
            const text = link.textContent?.trim() ?? "";
            const href = link.href;
            if (!text || !href)
                continue;
            // Skip nav/header/footer links
            if (href.includes("/search") || href.includes("/auth") || href.includes("#"))
                continue;
            // If we have URL segments to match, require them
            if (segments && !segments.some((seg) => href.includes(seg)))
                continue;
            // Match by name
            if (text.toLowerCase().includes(normalizedQuery) || normalizedQuery.includes(text.toLowerCase())) {
                return { name: text, url: href };
            }
        }
        return null;
    }, { q: query, segments: urlSegments });
}
/**
 * Shared helper: search a D&D Beyond category listing and return the URL of the first result.
 * Tries the category listing page first (works for monsters/spells/magic-items).
 * Falls back to DDB general search for categories with table-style pages (feats/races/classes/etc).
 * Supports source filtering: "official" (default), "homebrew" (community), "my-creations" (own).
 */
async function searchAndGetFirstUrl(context, category, query, source = "official") {
    const page = await getPage(context);
    const encodedQuery = encodeURIComponent(query);
    const segments = CATEGORY_URL_SEGMENTS[category] ?? [`/${category}/`];
    // ── My Creations ──────────────────────────────────────────────────────
    if (source === "my-creations") {
        await page.goto("https://www.dndbeyond.com/my-creations", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });
        await page.waitForTimeout(3000);
        // Click the matching creation link by text — use Playwright's text-based locator
        // which works regardless of the underlying link href format
        const matchedName = await page.evaluate(({ q }) => {
            const normalizedQuery = q.toLowerCase().trim();
            // Find all links on the page
            const links = Array.from(document.querySelectorAll("a"));
            for (const link of links) {
                const name = link.textContent?.trim() ?? "";
                if (!name || name.length < 2)
                    continue;
                if (name.toLowerCase().includes(normalizedQuery) || normalizedQuery.includes(name.toLowerCase())) {
                    // Exclude nav/pagination links
                    if (/^(next|previous|1|2|3|\d+)$/i.test(name))
                        continue;
                    return name;
                }
            }
            return null;
        }, { q: query });
        if (!matchedName) {
            throw new Error(`No matching creation found for "${query}" in your homebrew. Check /my-creations.`);
        }
        // Click the link by its text content
        await page.locator(`a:has-text("${matchedName.replace(/"/g, '\\"')}")`).first().click();
        await page.waitForTimeout(3000);
        const finalUrl = page.url();
        return { page, url: finalUrl, name: matchedName };
    }
    // ── Community Homebrew ────────────────────────────────────────────────
    if (source === "homebrew") {
        const homebrewUrl = `https://www.dndbeyond.com/homebrew/${category}?filter-search=${encodedQuery}`;
        await page.goto(homebrewUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
        // Try to find the search input and fill it (homebrew pages may not use URL params)
        const searchInput = await page.$('input[placeholder*="Name"], input[name*="filter-search"], input[name*="name"]');
        if (searchInput) {
            await searchInput.fill(query);
            await page.waitForTimeout(2000);
        }
        let result = await findLinkByText(page, query, segments);
        // Fallback: general search filtered to homebrew-like results
        if (!result) {
            const searchUrl = `https://www.dndbeyond.com/search?q=${encodedQuery}`;
            await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
            await page.waitForTimeout(1500);
            result = await findLinkByText(page, query, segments);
        }
        if (!result || !result.url) {
            throw new Error(`No homebrew found for "${query}" in ${category}.`);
        }
        await page.goto(result.url, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);
        return { page, url: result.url, name: result.name };
    }
    // ── Official (default) ────────────────────────────────────────────────
    const searchUrl = `https://www.dndbeyond.com/${category}?filter-search=${encodedQuery}`;
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    // Try standard card-style listing pages (monsters, spells, magic-items)
    let firstResult = await page.evaluate(() => {
        const listingLink = document.querySelector(".listing-body div.info[data-slug] a.link");
        if (listingLink) {
            return { name: listingLink.textContent?.trim() ?? "", url: listingLink.href };
        }
        const rowLink = document.querySelector(".listing-body .row a[href], .rpgdata-listing a.name-link, .results a.link");
        if (rowLink) {
            return { name: rowLink.textContent?.trim() ?? "", url: rowLink.href };
        }
        return null;
    });
    // Fallback: use DDB general search and find the first result matching our category
    if (!firstResult || !firstResult.url) {
        const generalSearchUrl = `https://www.dndbeyond.com/search?q=${encodedQuery}`;
        await page.goto(generalSearchUrl, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);
        firstResult = await page.evaluate((urlSegments) => {
            const links = Array.from(document.querySelectorAll("a[href]"));
            for (const link of links) {
                const href = link.href;
                if (urlSegments.some((seg) => href.includes(seg)) && link.textContent?.trim()) {
                    return { name: link.textContent.trim(), url: href };
                }
            }
            return null;
        }, segments);
    }
    if (!firstResult || !firstResult.url) {
        throw new Error(`No results found for "${query}" in ${category}.`);
    }
    await page.goto(firstResult.url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    return { page, url: firstResult.url, name: firstResult.name };
}
/**
 * List all items from the user's /my-creations page.
 */
export async function listMyCreations(context, type) {
    const page = await getPage(context);
    await page.goto("https://www.dndbeyond.com/my-creations", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });
    await page.waitForTimeout(3000);
    // Parse creations from innerText — the page renders as repeated blocks:
    //   {name}\n{status}\n{type}\n{date}\n{views}\n{adds}\n[version]
    // We detect creation entries by matching the type line (Monster, Item, Spell, etc.)
    const scrapeCurrentPage = async () => {
        return page.evaluate((getCleanTextStr) => {
            const getCleanText = new Function(`return (${getCleanTextStr})`)();
            const text = getCleanText();
            const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
            const items = [];
            const knownTypes = ["Monster", "Item", "Spell", "Feat", "Background", "Race", "Species", "Class", "Subclass"];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Check if this line is a known type keyword (exact match)
                if (knownTypes.some((t) => t.toLowerCase() === line.toLowerCase())) {
                    // The name is 2 lines before (name, then status, then type)
                    const name = lines[i - 2] ?? "";
                    const status = lines[i - 1] ?? "";
                    const type = line;
                    // Validate: name shouldn't be a header/nav item, status should contain Private/Published/Draft
                    if (name && /private|published|draft|never submitted|approved/i.test(status)) {
                        items.push({ name, type, status });
                    }
                }
            }
            return items;
        }, GET_CLEAN_TEXT.toString());
    };
    const creations = [];
    creations.push(...await scrapeCurrentPage());
    // Try to get page 2 if "Next" link exists
    const nextLink = await page.$('a:has-text("Next"), .pagination-next a, a[rel="next"]');
    if (nextLink) {
        await nextLink.click();
        await page.waitForTimeout(3000);
        creations.push(...await scrapeCurrentPage());
    }
    // Filter by type if specified
    const typeFilter = type?.toLowerCase();
    const filtered = typeFilter
        ? creations.filter((c) => c.type.toLowerCase().includes(typeFilter))
        : creations;
    return JSON.stringify({
        url: "https://www.dndbeyond.com/my-creations",
        count: filtered.length,
        creations: filtered,
        _hint: "Use ddb_get_monster/ddb_get_item/etc. with source 'my-creations' to view details.",
    }, null, 2);
}
/**
 * Shared helper: get the main content text of the current page, stripping nav/comments/footer.
 * Used inside page.evaluate() — returns the text to parse.
 */
const GET_CLEAN_TEXT = () => {
    // Remove noisy elements
    document.querySelectorAll("script, style, nav, footer, .ad-container, .advertisement").forEach((el) => el.remove());
    const main = document.querySelector("main, article, .main-content, .page-content, #content") ?? document.body;
    let text = main.innerText ?? "";
    // Cut off at comments section
    const commentsIdx = text.indexOf("\nComments\n");
    if (commentsIdx > -1)
        text = text.substring(0, commentsIdx);
    return text.trim();
};
// ─── getMonster ──────────────────────────────────────────────────────────────
export async function getMonster(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "monsters", query, source);
    const monster = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        // Name from page title (reliable across both official 2024 and homebrew pages)
        const name = document.querySelector("h1.page-title, h1")?.textContent?.trim() ?? "";
        // Find the meta line: "Large Monstrosity, Neutral" or "Medium Celestial, Chaotic Evil"
        // Skip nav/chrome lines (EDIT, DISABLE COMMENTS, MONSTER RULES, etc.)
        const metaRegex = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(.+?),\s*(.+)$/;
        let metaMatch = null;
        let metaIdx = 0;
        for (let i = 0; i < lines.length; i++) {
            metaMatch = lines[i].match(metaRegex);
            if (metaMatch) {
                metaIdx = i;
                break;
            }
        }
        const size = metaMatch?.[1] ?? "";
        const type = metaMatch?.[2] ?? "";
        const alignment = metaMatch?.[3] ?? "";
        // Parse the rest into a flat lookup (everything after meta line)
        const restText = lines.slice(metaIdx + 1).join("\n");
        // AC — handles both "AC 20 (natural armor)" and "Armor Class 20 (natural armor)"
        const acMatch = restText.match(/(?:^|\n)(?:AC|Armor Class)\s+(\d+(?:\s*\([^)]+\))?)/);
        const ac = acMatch?.[1] ?? "";
        // Initiative (2024 format only)
        const initMatch = restText.match(/Initiative\s+([+-]\d+(?:\s*\(\d+\))?)/);
        const initiative = initMatch?.[1] ?? "";
        // HP — handles both "HP 230 (20d8 + 140)" and "Hit Points 230 (20d8 + 140)"
        const hpMatch = restText.match(/(?:HP|Hit Points)\s+(\d+)\s*(\([^)]+\))?/);
        const hp = hpMatch?.[1] ?? "";
        const hit_dice = hpMatch?.[2]?.replace(/[()]/g, "").trim() ?? "";
        // Speed
        const speedMatch = restText.match(/Speed\s+(.+?)(?:\n|MOD|$)/);
        const speed = speedMatch?.[1]?.trim() ?? "";
        // Ability scores — two formats:
        // 2024: "STR 18 +4 +4" (score, modifier, save all on one line)
        // Homebrew: "STR\n22 (+6)" (label on one line, score+mod on next)
        const abilities = {};
        // Try 2024 format first: STR 18 +4 +4
        const abilityRegex2024 = /\b(STR|DEX|CON|INT|WIS|CHA)\s+(\d+)\s+([+-]\d+)\s+([+-]\d+)/g;
        let abilityMatch;
        while ((abilityMatch = abilityRegex2024.exec(restText)) !== null) {
            abilities[abilityMatch[1]] = {
                score: parseInt(abilityMatch[2], 10),
                modifier: abilityMatch[3],
                save: abilityMatch[4],
            };
        }
        // If no 2024-format abilities found, try homebrew format: STR\n22 (+6)
        if (Object.keys(abilities).length === 0) {
            const abilityNames = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (abilityNames.includes(line)) {
                    // Next line should be "22 (+6)" or just "22"
                    const valueLine = lines[i + 1]?.trim() ?? "";
                    const valMatch = valueLine.match(/^(\d+)\s*(?:\(([+-]\d+)\))?/);
                    if (valMatch) {
                        const score = parseInt(valMatch[1], 10);
                        const mod = valMatch[2] ?? `${Math.floor((score - 10) / 2) >= 0 ? "+" : ""}${Math.floor((score - 10) / 2)}`;
                        abilities[line] = { score, modifier: mod, save: mod };
                    }
                }
            }
        }
        // Tidbits: single-line fields — patterns handle both formats
        const tidbitPatterns = {
            skills: /Skills\s+(.+)/,
            senses: /Senses\s+(.+)/,
            languages: /Languages\s+(.+)/,
            challenge: /(?:CR|Challenge)\s+(.+)/,
            saving_throws: /Saving Throws?\s+(.+)/,
            damage_resistances: /Damage Resistances?\s+(.+)/,
            damage_immunities: /Damage Immunit(?:y|ies)\s+(.+)/,
            damage_vulnerabilities: /Damage Vulnerabilit(?:y|ies)\s+(.+)/,
            condition_immunities: /Condition Immunit(?:y|ies)\s+(.+)/,
        };
        const tidbits = {};
        for (const [key, pattern] of Object.entries(tidbitPatterns)) {
            const m = restText.match(pattern);
            if (m)
                tidbits[key] = m[1].trim();
        }
        // If we got saving throws from the tidbits, update abilities with correct saves
        if (tidbits["saving_throws"]) {
            const saveRegex = /(\w{3})\s+([+-]\d+)/g;
            let saveMatch;
            while ((saveMatch = saveRegex.exec(tidbits["saving_throws"])) !== null) {
                const abilityKey = saveMatch[1].toUpperCase();
                if (abilities[abilityKey]) {
                    abilities[abilityKey].save = saveMatch[2];
                }
            }
        }
        // Sections: Actions, Bonus Actions, Reactions, Legendary Actions, Mythic Actions
        const sectionHeaders = ["Traits", "Actions", "Bonus Actions", "Reactions", "Legendary Actions", "Mythic Actions", "Lair Actions"];
        // Find where the stat block entries begin (after CR/Challenge line or Proficiency Bonus line)
        const crLineIdx = restText.search(/(?:CR|Challenge)\s+\d/);
        const profBonusIdx = restText.search(/Proficiency Bonus\s+/);
        const sectionStart = Math.max(crLineIdx, profBonusIdx);
        const afterCR = sectionStart > -1 ? restText.substring(sectionStart) : restText;
        // Skip the CR/proficiency line itself
        const afterCRLines = afterCR.split("\n").slice(1).join("\n");
        const sections = {};
        let currentSection = "traits";
        sections[currentSection] = [];
        const entryLines = afterCRLines.split("\n");
        let currentEntry = null;
        let loreText = "";
        // Chrome/UI lines to skip in action parsing
        const chromeLines = /^(EDIT|DISABLE COMMENTS|REMOVE FROM COLLECTION|REPORT|CREATE NEW VERSION|SAVE|DELETE|SHARE|COPY|PRINT)/i;
        for (const line of entryLines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            if (chromeLines.test(trimmed))
                continue;
            // Check if this is a section header
            if (sectionHeaders.some((h) => h.toLowerCase() === trimmed.toLowerCase())) {
                if (currentEntry) {
                    sections[currentSection].push(currentEntry);
                    currentEntry = null;
                }
                currentSection = trimmed.toLowerCase();
                if (!sections[currentSection])
                    sections[currentSection] = [];
                continue;
            }
            // Check if this is a new entry (starts with "Name." or "Name (Recharge X)." pattern)
            // Also handle homebrew bold markers: "**Name.**" or "**Name (Costs 2 Actions).**"
            const cleanLine = trimmed.replace(/\*\*/g, "");
            const entryMatch = cleanLine.match(/^([A-Z][^.]+?(?:\s*\([^)]+\))?)\.\s+(.+)$/);
            const isActionEntry = entryMatch && entryMatch[1].length < 60;
            if (isActionEntry) {
                if (currentEntry) {
                    sections[currentSection].push(currentEntry);
                }
                currentEntry = { name: entryMatch[1], description: entryMatch[2] };
            }
            else {
                // Check if there are section headers still ahead — if so, this is a continuation, not lore
                const currentIdx = entryLines.indexOf(line);
                const hasMoreSections = entryLines.slice(currentIdx + 1).some((l) => sectionHeaders.some((h) => h.toLowerCase() === l.trim().toLowerCase()));
                if (currentEntry) {
                    // Continuation line of current entry
                    currentEntry.description += " " + trimmed;
                }
                else if (hasMoreSections || currentSection !== "traits") {
                    // Either orphaned text before a section header, or section intro text
                    // (e.g. "The dragon can take 3 legendary actions..." after Legendary Actions header)
                    // Store as a section intro entry
                    if (currentSection !== "traits" && !hasMoreSections) {
                        // Section intro — create an intro entry
                        currentEntry = { name: "_intro", description: trimmed };
                    }
                    continue;
                }
                else {
                    // Lore/flavor text — no more sections ahead and we're in traits
                    const remaining = entryLines.slice(currentIdx).filter((l) => !chromeLines.test(l.trim())).join("\n").trim();
                    if (remaining)
                        loreText = remaining;
                    break;
                }
            }
        }
        if (currentEntry) {
            sections[currentSection].push(currentEntry);
        }
        return {
            name,
            size,
            type,
            alignment,
            ac,
            initiative,
            hp,
            hit_dice,
            speed,
            abilities,
            skills: tidbits["skills"] ?? "",
            senses: tidbits["senses"] ?? "",
            languages: tidbits["languages"] ?? "",
            challenge: tidbits["challenge"] ?? "",
            damage_resistances: tidbits["damage_resistances"] ?? "",
            damage_immunities: tidbits["damage_immunities"] ?? "",
            damage_vulnerabilities: tidbits["damage_vulnerabilities"] ?? "",
            condition_immunities: tidbits["condition_immunities"] ?? "",
            traits: sections["traits"]?.length ? sections["traits"] : undefined,
            actions: sections["actions"]?.length ? sections["actions"] : undefined,
            bonus_actions: sections["bonus actions"]?.length ? sections["bonus actions"] : undefined,
            reactions: sections["reactions"]?.length ? sections["reactions"] : undefined,
            legendary_actions: sections["legendary actions"]?.length ? sections["legendary actions"] : undefined,
            mythic_actions: sections["mythic actions"]?.length ? sections["mythic actions"] : undefined,
            lore: loreText || undefined,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...monster }, null, 2);
}
// ─── getSpell ────────────────────────────────────────────────────────────────
export async function getSpell(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "spells", query, source);
    const spell = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        // The 2024 spell page has a structured grid at top with ALL-CAPS labels:
        // LEVEL\n1st\nCASTING TIME\n1 Action\n...
        // Followed by the description text.
        // Known labels in the stat grid
        const knownLabels = [
            "LEVEL", "CASTING TIME", "RANGE/AREA", "RANGE", "COMPONENTS",
            "DURATION", "SCHOOL", "ATTACK/SAVE", "DAMAGE/EFFECT",
        ];
        const details = {};
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        // Parse the structured header: label on one line, value on the next
        let i = 0;
        let lastLabel = "";
        let descriptionStart = 0;
        for (i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (knownLabels.includes(line.toUpperCase())) {
                lastLabel = line.toUpperCase();
                // Value is on the next line
                if (i + 1 < lines.length && !knownLabels.includes(lines[i + 1].toUpperCase())) {
                    details[lastLabel] = lines[i + 1];
                    i++; // skip the value line
                }
            }
            else if (lastLabel && !knownLabels.includes(line.toUpperCase())) {
                // We've moved past the stat grid — this is where description starts
                // But only if we've seen at least a few labels
                if (Object.keys(details).length >= 3) {
                    descriptionStart = i;
                    break;
                }
            }
        }
        // Everything after the stat grid is description
        const descriptionLines = lines.slice(descriptionStart);
        let description = "";
        let atHigherLevels = "";
        const higherLevelIdx = descriptionLines.findIndex((l) => /^using a higher[- ]level spell slot/i.test(l) || /^at higher levels/i.test(l));
        if (higherLevelIdx > -1) {
            description = descriptionLines.slice(0, higherLevelIdx).join("\n\n");
            atHigherLevels = descriptionLines
                .slice(higherLevelIdx)
                .join("\n\n")
                .replace(/^(?:using a higher[- ]level spell slot|at higher levels)\.?\s*/i, "")
                .trim();
        }
        else {
            description = descriptionLines.join("\n\n");
        }
        // Parse components
        const componentsRaw = details["COMPONENTS"] ?? "";
        const materialMatch = componentsRaw.match(/\(([^)]+)\)/);
        // Parse duration for concentration
        const durationRaw = details["DURATION"] ?? "";
        const concentration = /concentration/i.test(durationRaw);
        const duration = durationRaw.replace(/concentration,?\s*/i, "").trim() || durationRaw;
        return {
            name: document.querySelector("h1.page-title, h1")?.textContent?.trim() ?? "",
            level: details["LEVEL"] ?? "",
            school: details["SCHOOL"] ?? "",
            casting_time: details["CASTING TIME"] ?? "",
            range: details["RANGE/AREA"] ?? details["RANGE"] ?? "",
            components: {
                verbal: /\bV\b/.test(componentsRaw),
                somatic: /\bS\b/.test(componentsRaw),
                material: /\bM\b/.test(componentsRaw),
                material_description: materialMatch?.[1]?.trim() ?? "",
            },
            duration,
            concentration,
            attack_save: details["ATTACK/SAVE"] ?? "",
            damage_effect: details["DAMAGE/EFFECT"] ?? "",
            description: description.trim(),
            at_higher_levels: atHigherLevels,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...spell }, null, 2);
}
// ─── getItem ─────────────────────────────────────────────────────────────────
export async function getItem(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "magic-items", query, source);
    const item = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        // Magic item pages 2024 format:
        // First meaningful line: "Wand, uncommon" or "Weapon (Longsword), rare (requires attunement)"
        // Then description paragraphs
        // Skip nav/header/chrome lines
        let startIdx = 0;
        while (startIdx < lines.length && /^(Skip to|Hi,|MAGIC ITEM|BROWSE|CREATE|EDIT|DISABLE COMMENTS|REMOVE FROM|REPORT|SAVE|DELETE|SHARE|COPY|PRINT|CREATE NEW VERSION)/i.test(lines[startIdx])) {
            startIdx++;
        }
        // Find the meta line: "Wand, uncommon" or "Weapon (greatsword), artifact (requires attunement...)"
        // It should contain a comma and a rarity keyword or item type
        const rarityKeywords = /common|uncommon|rare|very rare|legendary|artifact/i;
        const itemTypeKeywords = /^(Armor|Weapon|Wand|Rod|Ring|Potion|Scroll|Staff|Wonderous|Wondrous)/i;
        while (startIdx < lines.length) {
            const line = lines[startIdx];
            if (rarityKeywords.test(line) || itemTypeKeywords.test(line))
                break;
            startIdx++;
        }
        // First line is type + rarity meta
        const metaLine = lines[startIdx] ?? "";
        // Parse "Type, rarity" or "Type, rarity (requires attunement by ...)"
        const attunementMatch = metaLine.match(/\(requires attunement(?:\s+by\s+(.+?))?\)/i);
        const attunement = attunementMatch ? (attunementMatch[1] ? `Requires attunement by ${attunementMatch[1]}` : "Requires attunement") : "";
        const cleanMeta = metaLine.replace(/\s*\(requires attunement[^)]*\)/i, "").trim();
        const metaParts = cleanMeta.split(",").map((s) => s.trim());
        const itemType = metaParts[0] ?? "";
        const rarity = metaParts[1] ?? "";
        // Rest is description — filter out chrome/UI lines
        const chromeRegex = /^(EDIT|DISABLE COMMENTS|REMOVE FROM COLLECTION|REPORT|CREATE NEW VERSION|SAVE|DELETE|SHARE|COPY|PRINT)$/i;
        const description = lines.slice(startIdx + 1)
            .filter((l) => !chromeRegex.test(l.trim()))
            .join("\n\n").trim();
        // Try to extract the item name from the page title
        const titleEl = document.querySelector("h1.page-title, h1");
        const name = titleEl?.textContent?.trim() ?? "";
        return {
            name,
            type: itemType,
            rarity,
            attunement,
            description,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...item }, null, 2);
}
// ─── getFeat ──────────────────────────────────────────────────────────────────
export async function getFeat(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "feats", query, source);
    const feat = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const titleEl = document.querySelector("h1.page-title, h1");
        const name = titleEl?.textContent?.trim() ?? "";
        // Skip nav lines
        let startIdx = 0;
        while (startIdx < lines.length && /^(Skip to|Hi,|FEAT|BROWSE|CREATE)/i.test(lines[startIdx])) {
            startIdx++;
        }
        // Look for prerequisite line
        let prerequisite = "";
        let descStart = startIdx;
        for (let i = startIdx; i < Math.min(startIdx + 5, lines.length); i++) {
            if (/prerequisite/i.test(lines[i])) {
                prerequisite = lines[i].replace(/^prerequisite:?\s*/i, "").trim();
                descStart = i + 1;
                break;
            }
        }
        // Look for category/type line (e.g. "Origin Feat", "General Feat", "4th-Level Feat")
        let category = "";
        for (let i = startIdx; i < Math.min(startIdx + 5, lines.length); i++) {
            if (/feat$/i.test(lines[i]) && lines[i].length < 50) {
                category = lines[i];
                if (descStart <= i)
                    descStart = i + 1;
                break;
            }
        }
        const description = lines.slice(descStart).join("\n\n").trim();
        return {
            name,
            category,
            prerequisite,
            description,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...feat }, null, 2);
}
// ─── getRace ──────────────────────────────────────────────────────────────────
export async function getRace(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "races", query, source);
    const race = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        const titleEl = document.querySelector("h1.page-title, h1");
        const name = titleEl?.textContent?.trim() ?? "";
        // Parse known fields from the text
        const fieldPatterns = {
            size: /Size:\s*(.+)/i,
            speed: /Speed:\s*(.+)/i,
            creature_type: /Creature Type:\s*(.+)/i,
            languages: /Languages?:\s*(.+)/i,
            ability_score_increase: /Ability Score (?:Increase|Modifier)s?:\s*(.+)/i,
            darkvision: /Darkvision\.?\s*(.+)/i,
        };
        const fields = {};
        for (const [key, pattern] of Object.entries(fieldPatterns)) {
            const m = text.match(pattern);
            if (m)
                fields[key] = m[1].trim();
        }
        // Full description (everything after nav/header, before comments)
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        let startIdx = 0;
        while (startIdx < lines.length && /^(Skip to|Hi,|RACE|SPECIES|BROWSE|CREATE)/i.test(lines[startIdx])) {
            startIdx++;
        }
        const description = lines.slice(startIdx).join("\n\n").trim();
        return {
            name,
            ...fields,
            description,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...race }, null, 2);
}
// ─── getClass ─────────────────────────────────────────────────────────────────
export async function getClass(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "classes", query, source);
    const classData = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        const titleEl = document.querySelector("h1.page-title, h1");
        const name = titleEl?.textContent?.trim() ?? "";
        // Parse known fields
        const fieldPatterns = {
            hit_die: /Hit Die:\s*(.+)/i,
            primary_ability: /Primary Ability:\s*(.+)/i,
            saving_throws: /Saving Throw Proficiencies?:\s*(.+)/i,
            armor_proficiencies: /Armor(?:\s+Training)?:\s*(.+)/i,
            weapon_proficiencies: /Weapon(?:\s+Proficiencies)?:\s*(.+)/i,
            tool_proficiencies: /Tool Proficiencies?:\s*(.+)/i,
            skills: /Skill Proficiencies?:\s*(.+)/i,
        };
        const fields = {};
        for (const [key, pattern] of Object.entries(fieldPatterns)) {
            const m = text.match(pattern);
            if (m)
                fields[key] = m[1].trim();
        }
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        let startIdx = 0;
        while (startIdx < lines.length && /^(Skip to|Hi,|CLASS|BROWSE|CREATE)/i.test(lines[startIdx])) {
            startIdx++;
        }
        const description = lines.slice(startIdx).join("\n\n").trim();
        return {
            name,
            ...fields,
            description,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...classData }, null, 2);
}
// ─── getBackground ────────────────────────────────────────────────────────────
export async function getBackground(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "backgrounds", query, source);
    const background = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        const titleEl = document.querySelector("h1.page-title, h1");
        const name = titleEl?.textContent?.trim() ?? "";
        // Parse known fields
        const fieldPatterns = {
            ability_scores: /Ability Scores?:\s*(.+)/i,
            skill_proficiencies: /Skill Proficiencies?:\s*(.+)/i,
            tool_proficiencies: /Tool Proficiencies?:\s*(.+)/i,
            feat: /Feat:\s*(.+)/i,
            equipment: /Equipment:\s*(.+)/i,
            languages: /Languages?:\s*(.+)/i,
        };
        const fields = {};
        for (const [key, pattern] of Object.entries(fieldPatterns)) {
            const m = text.match(pattern);
            if (m)
                fields[key] = m[1].trim();
        }
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        let startIdx = 0;
        while (startIdx < lines.length && /^(Skip to|Hi,|BACKGROUND|BROWSE|CREATE)/i.test(lines[startIdx])) {
            startIdx++;
        }
        const description = lines.slice(startIdx).join("\n\n").trim();
        return {
            name,
            ...fields,
            description,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...background }, null, 2);
}
// ─── getCondition ─────────────────────────────────────────────────────────────
export async function getCondition(context, query) {
    const page = await getPage(context);
    // Navigate to the free rules glossary which contains all conditions
    const glossaryUrl = "https://www.dndbeyond.com/sources/dnd/free-rules/rules-glossary";
    await page.goto(glossaryUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    const condition = await page.evaluate((searchQuery) => {
        const normalizedQuery = searchQuery.toLowerCase().trim();
        // The rules glossary has headings with anchors for each entry.
        const headings = Array.from(document.querySelectorAll("h2, h3, h4, h5"));
        let matchedHeading = null;
        for (const h of headings) {
            const text = h.textContent?.trim().toLowerCase() ?? "";
            if (text === normalizedQuery ||
                text === `${normalizedQuery} [condition]` ||
                text.startsWith(normalizedQuery + " ") ||
                text.includes(normalizedQuery)) {
                matchedHeading = h;
                break;
            }
        }
        if (!matchedHeading) {
            // Try anchor-based lookup
            const capitalizedQuery = searchQuery.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
            const possibleIds = [
                capitalizedQuery,
                capitalizedQuery + "Condition",
                normalizedQuery.replace(/\s+/g, ""),
            ];
            for (const id of possibleIds) {
                const el = document.getElementById(id);
                if (el) {
                    matchedHeading = el;
                    break;
                }
            }
        }
        if (!matchedHeading)
            return null;
        const name = matchedHeading.textContent?.trim() ?? "";
        const headingLevel = parseInt(matchedHeading.tagName.replace("H", ""), 10);
        let description = "";
        let el = matchedHeading.nextElementSibling;
        while (el) {
            const tagName = el.tagName.toUpperCase();
            if (/^H[1-6]$/.test(tagName)) {
                const siblingLevel = parseInt(tagName.replace("H", ""), 10);
                if (siblingLevel <= headingLevel)
                    break;
            }
            description += el.innerText?.trim() + "\n\n";
            el = el.nextElementSibling;
        }
        return { name, description: description.trim() };
    }, query);
    if (!condition) {
        // Fallback: general search
        const searchUrl = `https://www.dndbeyond.com/search?q=${encodeURIComponent(query + " condition")}`;
        await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);
        const fallbackResult = await page.evaluate(() => {
            const main = document.querySelector("main, article, .main-content") ?? document.body;
            return main.innerText?.trim() ?? "";
        });
        return JSON.stringify({
            url: searchUrl,
            name: query,
            description: "",
            _raw_text: fallbackResult.slice(0, 4000),
            _note: "Could not find structured condition data. Raw search results included as fallback.",
        }, null, 2);
    }
    return JSON.stringify({ url: glossaryUrl, ...condition }, null, 2);
}
// ─── getRule ──────────────────────────────────────────────────────────────────
export async function getRule(context, query) {
    const page = await getPage(context);
    // Helper to extract a rule from a page by heading match
    async function extractRuleFromPage(pageUrl) {
        await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1000);
        return page.evaluate((searchQuery) => {
            const normalizedQuery = searchQuery.toLowerCase().trim();
            const headings = Array.from(document.querySelectorAll("h2, h3, h4, h5"));
            let matchedHeading = null;
            let bestScore = 0;
            for (const h of headings) {
                const text = h.textContent?.trim().toLowerCase() ?? "";
                if (text === normalizedQuery) {
                    matchedHeading = h;
                    bestScore = 100;
                    break;
                }
                if (text.includes(normalizedQuery) && normalizedQuery.length > 3) {
                    const score = (normalizedQuery.length / text.length) * 50;
                    if (score > bestScore) {
                        bestScore = score;
                        matchedHeading = h;
                    }
                }
            }
            if (!matchedHeading || bestScore < 10)
                return null;
            const name = matchedHeading.textContent?.trim() ?? "";
            const headingLevel = parseInt(matchedHeading.tagName.replace("H", ""), 10);
            let description = "";
            let el = matchedHeading.nextElementSibling;
            while (el) {
                const tagName = el.tagName.toUpperCase();
                if (/^H[1-6]$/.test(tagName)) {
                    const siblingLevel = parseInt(tagName.replace("H", ""), 10);
                    if (siblingLevel <= headingLevel)
                        break;
                }
                description += el.innerText?.trim() + "\n\n";
                el = el.nextElementSibling;
            }
            return { name, description: description.trim() };
        }, query);
    }
    // Try rules glossary first
    const glossaryUrl = "https://www.dndbeyond.com/sources/dnd/free-rules/rules-glossary";
    const glossaryResult = await extractRuleFromPage(glossaryUrl);
    if (glossaryResult) {
        return JSON.stringify({ url: glossaryUrl, ...glossaryResult }, null, 2);
    }
    // Fallback: try free rules chapters
    const chapters = ["playing-the-game", "combat", "spellcasting", "equipment", "creating-a-character"];
    for (const chapter of chapters) {
        const chapterUrl = `https://www.dndbeyond.com/sources/dnd/free-rules/${chapter}`;
        const chapterResult = await extractRuleFromPage(chapterUrl);
        if (chapterResult) {
            return JSON.stringify({ url: chapterUrl, ...chapterResult }, null, 2);
        }
    }
    // Final fallback: general search
    const searchUrl = `https://www.dndbeyond.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    const searchContent = await page.evaluate(() => {
        const main = document.querySelector("main, article, .main-content") ?? document.body;
        return main.innerText?.trim() ?? "";
    });
    return JSON.stringify({
        url: searchUrl,
        name: query,
        description: "",
        _raw_text: searchContent.slice(0, 4000),
        _note: "Could not find exact rule. Raw search results included.",
    }, null, 2);
}
// ─── getEquipment ─────────────────────────────────────────────────────────────
export async function getEquipment(context, query, source = "official") {
    const { page, url } = await searchAndGetFirstUrl(context, "equipment", query, source);
    const equipment = await page.evaluate((getCleanTextStr) => {
        const getCleanText = new Function(`return (${getCleanTextStr})`)();
        const text = getCleanText();
        const titleEl = document.querySelector("h1.page-title, h1");
        const name = titleEl?.textContent?.trim() ?? "";
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        // Parse known fields from text
        const fieldPatterns = {
            type: /Type:\s*(.+)/i,
            cost: /Cost:\s*(.+)/i,
            weight: /Weight:\s*(.+)/i,
            damage: /Damage:\s*(.+)/i,
            properties: /Properties?:\s*(.+)/i,
            armor_class: /Armor Class:\s*(.+)/i,
        };
        const fields = {};
        for (const [key, pattern] of Object.entries(fieldPatterns)) {
            const m = text.match(pattern);
            if (m)
                fields[key] = m[1].trim();
        }
        let startIdx = 0;
        while (startIdx < lines.length && /^(Skip to|Hi,|EQUIPMENT|BROWSE|CREATE)/i.test(lines[startIdx])) {
            startIdx++;
        }
        const description = lines.slice(startIdx).join("\n\n").trim();
        return {
            name,
            ...fields,
            description,
        };
    }, GET_CLEAN_TEXT.toString());
    return JSON.stringify({ url, ...equipment }, null, 2);
}
//# sourceMappingURL=compendium.js.map