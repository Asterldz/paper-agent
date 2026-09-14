import reading from '../../agent-skills/paper-reading/SKILL.md?raw';
import evolution from '../../agent-skills/paper-reading-evolution/SKILL.md?raw';

const body = (value: string) => value.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
export const READING_SKILL = body(reading);
export const EVOLUTION_SKILL = body(evolution);
