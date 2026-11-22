// Font stacks and weights shared by the SVG renderer, text metrics and the text controls.
// Kept free of other render imports so text-metrics can use it without a cycle.

/** Map a stored font-family key to a concrete CSS font stack (see index.html). */
export const FONT_STACKS: Record<string, string> = {
   normal: "'Nunito', 'Segoe UI', system-ui, sans-serif",
   inter: "'Inter', 'Segoe UI', system-ui, sans-serif",
   poppins: "'Poppins', 'Segoe UI', system-ui, sans-serif",
   serif: "'Lora', Georgia, 'Times New Roman', serif",
   display: "'Playfair Display', Georgia, 'Times New Roman', serif",
   grotesk: "'Space Grotesk', 'Inter', system-ui, sans-serif",
   condensed: "'Oswald', 'Arial Narrow', Impact, sans-serif",
   hand: "'Kalam', 'Comic Sans MS', cursive",
   caveat: "'Caveat', 'Segoe Script', cursive",
   marker: "'Permanent Marker', 'Marker Felt', cursive",
   code: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace",
};

/** Font choices offered in the text controls (labels are drawn in their own face). */
export const FONT_OPTIONS: { value: string; label: string }[] = [
   { value: 'normal', label: 'Nunito' },
   { value: 'inter', label: 'Inter' },
   { value: 'poppins', label: 'Poppins' },
   { value: 'serif', label: 'Lora (serif)' },
   { value: 'display', label: 'Playfair (display)' },
   { value: 'grotesk', label: 'Space Grotesk' },
   { value: 'condensed', label: 'Oswald (condensed)' },
   { value: 'hand', label: 'Kalam (hand)' },
   { value: 'caveat', label: 'Caveat (script)' },
   { value: 'marker', label: 'Permanent Marker' },
   { value: 'code', label: 'JetBrains Mono' },
];

export function fontStack(key: string | undefined): string {
   return FONT_STACKS[key ?? 'normal'] ?? FONT_STACKS['normal'];
}

/** Text stroke-width maps to font weight (so the width control affects text). */
export function fontWeightFor(strokeWidth: number): number {
   return strokeWidth <= 1 ? 400 : strokeWidth <= 2 ? 600 : 800;
}
