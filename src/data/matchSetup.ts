import type { ChapterConfig } from './chapters';
import { assignRivalElements, type Element } from './elements';
import type { DifficultyId, MatchSetup } from '../sim/match';

/** Build a sim match from a chapter config. Rivals take elements the humans did not pick. */
export function matchSetupFromChapter(chapter: ChapterConfig, humanElements: Element[], difficulty: DifficultyId): MatchSetup {
  const elements = assignRivalElements(humanElements, chapter.rivals.length);
  return {
    humanElements,
    rivals: chapter.rivals.map((r, i) => ({ id: r.id, name: r.name, personality: r.personality, element: elements[i]! })),
    targetShare: chapter.targetShare,
    palaceWinMana: chapter.palaceWinMana,
    aiLevel: chapter.aiLevel,
    comeback: chapter.comeback,
    difficulty,
    enemyDensity: chapter.enemyDensity,
  };
}
