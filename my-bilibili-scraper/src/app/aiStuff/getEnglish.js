const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: '***REMOVED***',
  baseURL: "https://api.moonshot.cn/v1",
});

export default async function getEnglishName(chineseName) {
  try {
    const completion = await client.chat.completions.create({
      model: 'moonshot-v1-8k',
      messages: [{
        role: 'system', content: 'Return just the best adaptive translation only in a Youtube title format.',
        role: 'user', content: `Translate the following Chinese video title into English for an english speaking ASMR audience and then make it clickbait. ${chineseName} Do not add anything else except the best adaptive translation and return the clickbait title only. Omit any hashtags.`,
        }],
      temperature: 0.3,
    });

    console.log(completion.choices[0].message.content);
    return completion.choices[0].message.content
  } catch (error) {
    console.error('Error creating completion:', error);
  }
};
