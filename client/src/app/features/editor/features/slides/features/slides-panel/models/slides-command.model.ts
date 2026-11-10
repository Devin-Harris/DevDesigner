/** What the panel asks the editor to do (things that need canvas knowledge). */
export type SlidesCommand =
   | { kind: 'present'; from: 'start' | 'current' }
   | { kind: 'preview'; id: string }
   | { kind: 'focus'; id: string }
   | { kind: 'duplicate'; id: string; ids?: string[]; toIndex?: number }
   | { kind: 'delete'; id: string }
   /** `layout`: add a layout; `layoutId`: the new slide's layout (null = blank, absent = as shown). */
   | { kind: 'add'; layout?: boolean; layoutId?: string | null }
   | { kind: 'deletePresentation' }
   | { kind: 'close' }
   | { kind: 'fold' }
   /** Focus mode: open one of its screens (DeckMorph / DeckAnim / DeckDesign mocks). */
   | { kind: 'screen'; screen: 'main' | 'morph' | 'anim' | 'design' };
