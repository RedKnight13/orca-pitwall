// Markup that only differs in its ticking clocks is the same markup: main.ts keeps those clocks
// current each second, so a snapshot that changes nothing else must not redraw anything.

const CLOCK_TEXT = /(<[^>]*\sdata-(?:since|ago|until)="[^"]*"[^>]*>)[^<]*/g
const GROW_STYLE = /(<[^>]*\sdata-grow="[^"]*"[^>]*?)\s+style="[^"]*"/g

/** The markup with clock text and growing widths taken out, for comparing two renders. */
export function stable(html: string): string {
  return html.replace(CLOCK_TEXT, '$1').replace(GROW_STYLE, '$1')
}

