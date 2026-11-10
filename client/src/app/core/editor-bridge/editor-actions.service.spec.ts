import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type DeckSummary, EditorActionsService, type EditorStateSources } from './editor-actions.service';

function sources() {
   return {
      canExportSql: signal(false),
      hasTableSelection: signal(true),
      hasSelection: signal(true),
      presentationName: signal<string | null>('Deck'),
      hasPlainFrames: signal(true),
      decks: signal<DeckSummary[]>([{ name: 'Deck', slides: 2, presenter: null }]),
      focusedDeck: signal<string | null>(null),
      following: signal<string | null>(null),
   } satisfies EditorStateSources;
}

describe('EditorActionsService', () => {
   it('shows defaults while no editor is mounted', () => {
      const actions = TestBed.inject(EditorActionsService);
      expect(actions.canExportSql()).toBe(true);
      expect(actions.hasSelection()).toBe(false);
      expect(actions.decks()).toEqual([]);
      expect(actions.focusedDeck()).toBeNull();
   });

   it('follows the registered editor state live', () => {
      const actions = TestBed.inject(EditorActionsService);
      const s = sources();
      actions.registerState(s);
      expect(actions.canExportSql()).toBe(false);
      expect(actions.presentationName()).toBe('Deck');
      expect(actions.decks().map((d) => d.name)).toEqual(['Deck']);
      s.focusedDeck.set('Deck');
      s.following.set('p2');
      expect(actions.focusedDeck()).toBe('Deck');
      expect(actions.following()).toBe('p2');
   });

   it('falls back to the defaults on clear', () => {
      const actions = TestBed.inject(EditorActionsService);
      actions.register({} as never);
      actions.registerState(sources());
      expect(actions.active()).toBe(true);
      actions.clear();
      expect(actions.active()).toBe(false);
      expect(actions.hasSelection()).toBe(false);
      expect(actions.canExportSql()).toBe(true);
      expect(actions.decks()).toEqual([]);
      expect(actions.presentationName()).toBeNull();
   });
});
