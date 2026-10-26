import data from './wizards.json';
import type { Element } from './elements';

export interface WizardLook {
  element: Element;
  name: string;
  gender: 'man' | 'woman';
  robe: string;
  sash: string;
  headwear: string;
  trim: string;
  skin: string;
  gem: string;
  beard: boolean;
}

export function wizardLook(element: Element): WizardLook {
  const w = (data.wizards as Record<string, Omit<WizardLook, 'element'>>)[element]!;
  return { element, ...w } as WizardLook;
}
