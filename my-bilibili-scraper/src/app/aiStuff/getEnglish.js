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
        role: 'system', content: 'You are creating a youtube title, firstly rewrite and summarize the input and then translates it from Chinese to English for an english speaking ASMR audience. Return just the answer with the best adaptive translation only.',
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
