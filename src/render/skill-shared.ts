import type { SkillSource } from "../config/schema.js";

export interface SkillInput {
  source: SkillSource;
  body: string;
}

export const SHARED_KEY_ORDER: ReadonlyArray<keyof SkillSource> = [
  "name",
  "description",
  "allowed-tools",
];
