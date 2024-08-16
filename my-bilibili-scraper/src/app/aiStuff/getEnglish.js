const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: 'sk-2CY5RG9FJS1SfS7AY5CuVwNEAdX6eRx4tGAup8UhyVwjII6O',
  baseURL: "https://api.moonshot.cn/v1",
});

export default async function getEnglishName(chineseName) {
  try {
    const completion = await client.chat.completions.create({
      model: 'moonshot-v1-8k',
      messages: [{
        role: 'user', content: `Translate the following Chinese video title into English for an english speaking ASMR audience, shorten the English description and add emojis. ${chineseName} Only return the adaptive translation. Omit any hashtags.`,
        }],
      temperature: 0.3,
    });

    console.log(completion.choices[0].message.content);
    return completion.choices[0].message.content
  } catch (error) {
    console.error('Error creating completion:', error);
  }
};
