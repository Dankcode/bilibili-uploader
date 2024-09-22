const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: 'sk-2CY5RG9FJS1SfS7AY5CuVwNEAdX6eRx4tGAup8UhyVwjII6O',
  baseURL: "https://api.moonshot.cn/v1",
});

async function getEnglishData(chineseName, chineseDesc) {
  try {
    const completion = await client.chat.completions.create({
      model: 'moonshot-v1-8k',
      messages: [{
        role: 'user', content: `Return in the following javascript object format:
        {Title: Translate the following Chinese video title into English for an english speaking ASMR audience, shorten the title and add emojis suitable for a Youtube title. ${chineseName}
        Only return a single response. Omit any hashtags.,

        Description: You are a single dedicated ASMR video content creator working by youreself, create a English thank you for watching description for a Youtube video using this 
        as a reference for an English speaking ASMR audience with an Asian women fetish. 
        ${chineseDesc}
        Give people the feeling they need to protect you and make it sound casual
        like a conversation in the first person perspective with slight asian themes, 
        but do not mention we, you, or the audience, remove unnecessary punctuations and vocabulary. 

        Tags: Create an array of 10 English tags for a suitable audience that will enjoy Chinese Youtube ASMR videos with half the tags targeting asian fetish and avoid using obvious 
        fetish words using this Chinese title: ${chineseName}. Everything must be in English. Use the following as how to return
        [Tag1 Tag2 Tag3]         
        }
        `,
        },
      ],
      temperature: 0.3,
    });
    console.log(completion.choices[0].message.content)
    return completion.choices[0].message.content
  } catch (error) {
    console.error('Error creating completion:', error);
  }
};

// async function getEnglishDescription(chineseName) {
//   try {
//     const completion = await client.chat.completions.create({
//       model: 'moonshot-v1-8k',
//       messages: [      
//       {
//         role: 'user', 
//         content: `You are a single dedicated ASMR video content creator working by youreself, create a two sentence English thank you for watching description for a Youtube video using this 
//         Chinese title ${chineseName} as a reference for an English speaking ASMR audience with an Asian women fetish. Give people the feeling they need to protect you and make it sound casual
//         like a conversation in the first person perspective with slight asian themes, 
//         but do not mention we`,
//       },
//       ],
//       temperature: 0.3,
//     });
//     console.log(completion.choices[0].message.content)
//     return completion.choices[0].message.content
//   } catch (error) {
//     console.error('Error creating completion:', error);
//   }
// };
// async function getTags(chineseName) {
//   try {
//     const completion = await client.chat.completions.create({
//       model: 'moonshot-v1-8k',
//       messages: [      
//       {
//         role: 'user', 
//         content: `Create an array of 10 English tags for a suitable audience that will enjoy Chinese Youtube ASMR videos with half the tags targeting asian fetish and avoid using obvious fetish words using this Chinese title: ${chineseName}. 
//         Only return with brackets at the beginning and end of the list, separated with spaces, do not include commas, omit any other information`,
//       },
//       ],
//       temperature: 0.3,
//     });
//     console.log(completion.choices)
//     return completion.choices[0].message.content
//   } catch (error) {
//     console.error('Error creating completion:', error);
//   }
// };
export {
  getEnglishData,
  // getEnglishDescription,
  // getTags,
}