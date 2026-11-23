// Tables that fit a phone. Every cell of a table with a header row is given its column's name
// (`data-label`), and the first cell of each row is marked as the row's title, so the stylesheet
// can lay each row out as a card on a narrow screen. The pages go on writing plain tables.
export function cards(html) {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (table, inner) => {
    const heads = [...inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim());
    if (!heads.length) return table;
    const body = inner.replace(/<tr([^>]*)>([\s\S]*?)<\/tr>/g, (row, attrs, cells) => {
      if (cells.includes('<th')) return row;
      let i = 0;
      const marked = cells.replace(/<td((?:\s[^>]*)?)>/g, (_, rest) => {
        const label = heads[i] ?? '';
        const lead = i++ === 0;
        const withClass = lead ? (/class="/.test(rest) ? rest.replace('class="', 'class="lead ') : `${rest} class="lead"`) : rest;
        return `<td${withClass}${label ? ` data-label="${label.replace(/"/g, '&quot;')}"` : ''}>`;
      });
      return `<tr${attrs}>${marked}</tr>`;
    });
    return `<table class="cards">${body}</table>`;
  });
}
