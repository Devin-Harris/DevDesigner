import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService.themeChanged$', () => {
   it('fires after the dark class flips, so token readers see the new theme', () => {
      const theme = TestBed.inject(ThemeService);
      theme.setMode('light');
      TestBed.tick();
      const seen$ = computed(() => {
         theme.themeChanged$();
         return document.documentElement.classList.contains('dark');
      });
      expect(seen$()).toBe(false);
      theme.toggle();
      TestBed.tick();
      expect(seen$()).toBe(true);
   });
});
