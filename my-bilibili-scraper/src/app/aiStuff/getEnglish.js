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
        role: 'system', content: 'You are creating a youtube title, firstly rewrite and summarize the Chinese title and then translate it to English for an english speaking ASMR audience. Return just the best adaptive translation only in a Youtube title format with no more than 10 words.',
        role: 'user', content: chineseName,
        }],
      temperature: 0.3,
    });

    console.log(completion.choices[0].message.content);
    return completion.choices[0].message.content
  } catch (error) {
    console.error('Error creating completion:', error);
  }
};
