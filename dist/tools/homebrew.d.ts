import { BrowserContext } from "playwright";
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
    abilities?: Record<string, {
        score: number;
        save?: string;
    }>;
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
export declare function editMonster(context: BrowserContext, id: string, data: MonsterData): Promise<string>;
export declare function createMonster(context: BrowserContext, data: MonsterData): Promise<string>;
export declare function editItem(context: BrowserContext, id: string, data: ItemData): Promise<string>;
export declare function createItem(context: BrowserContext, data: ItemData): Promise<string>;
export declare function deleteHomebrew(context: BrowserContext, type: "monster" | "item", id: string): Promise<string>;
export {};
//# sourceMappingURL=homebrew.d.ts.map