export const EDITORIAL_RULES = `
- Make the title specific to the actual activity or subject, with the most useful words first. Avoid generic hype and repetitive title formulas.
- Open the description with two concrete sentences explaining what viewers will see or hear. Use short, varied sentences; avoid boilerplate and keyword stuffing.
- Let the requested personality affect rhythm and vocabulary, never facts, ownership, sponsorship, or promises.
- Choose tags that accurately identify the topic and format. Do not pad them with unrelated popular searches.
Write like a person who has watched the video: concrete, natural and conversational.
Avoid stock openings, hype, keyword stuffing, invented personal experiences, and generic calls to subscribe.
Vary sentence length. Use only details supported by the source. Never imply the uploader created someone else's footage.
Do not use em dashes. Use a comma, colon, period or parentheses instead.
Keep tags relevant and specific to what is actually in the video.`;

export function naturalText(value) {
  return String(value || '').replace(/\s*\u2014\s*/g, ', ').replace(/[, ]+,/g, ',').trim();
}

export function cleanGeneratedMetadata(value = {}) {
  return {
    ...value,
    ...Object.fromEntries(['Title', 'Description', 'titleEn', 'descriptionEn', 'text'].filter((key) => key in value).map((key) => [key, naturalText(value[key])])),
    ...Object.fromEntries(['Tags', 'tags'].filter((key) => key in value).map((key) => [key,
      [...new Set((Array.isArray(value[key]) ? value[key] : String(value[key] || '').split(/[,\n]/)).map(naturalText).filter(Boolean))],
    ])),
  };
}
