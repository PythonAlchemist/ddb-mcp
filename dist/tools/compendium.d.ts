import { BrowserContext } from "playwright";
export type CompendiumSource = "official" | "homebrew" | "my-creations";
/**
 * List all items from the user's /my-creations page.
 */
export declare function listMyCreations(context: BrowserContext, type?: string): Promise<string>;
export declare function getMonster(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
export declare function getSpell(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
export declare function getItem(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
export declare function getFeat(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
export declare function getRace(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
export declare function getClass(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
export declare function getBackground(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
export declare function getCondition(context: BrowserContext, query: string): Promise<string>;
export declare function getRule(context: BrowserContext, query: string): Promise<string>;
export declare function getEquipment(context: BrowserContext, query: string, source?: CompendiumSource): Promise<string>;
//# sourceMappingURL=compendium.d.ts.map