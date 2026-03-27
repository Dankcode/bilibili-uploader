from openai import OpenAI
 
client = OpenAI(
    api_key = "sk-2CY5RG9FJS1SfS7AY5CuVwNEAdX6eRx4tGAup8UhyVwjII6O",
    base_url = "https://api.moonshot.cn/v1",
)
 
completion = client.chat.completions.create(
    model = "moonshot-v1-8k",
    messages = [
        {"role": "system", "content": "You are creating a youtube title, firstly rewrite and summarize the input and then translates it from Chinese to English for an english speaking ASMR audience. Return just the answer with the best adaptive translation only."},
        {"role": "user", "content": "【泡饭助眠】不同的刷子来刷你的脸部各种部位｜轻语｜带走你的疲惫"}
    ],
    temperature = 0.3,
)
 
print(completion.choices[0].message.content)

#grabs the input to fill out the table for the SQL after  

# """
# gemini api is a dud
# Install the Google AI Python SDK

# $ pip install google-generativeai

# See the getting started guide for more information:
# https://ai.google.dev/gemini-api/docs/get-started/python
# """

# import google.generativeai as genai
# genai.configure(api_key="AIzaSyC-z8Kk7VnKQATzORmIwgWiK2ct99K4TVk")

# # Create the model
# # See https://ai.google.dev/api/python/google/generativeai/GenerativeModel
# generation_config = {
#   "temperature": 1,
#   "top_p": 0.95,
#   "top_k": 64,
#   "max_output_tokens": 1000,
#   "response_mime_type": "text/plain",
# }
# safety_settings = [
#   {
#     "category": "HARM_CATEGORY_HARASSMENT",
#     "threshold": "BLOCK_MEDIUM_AND_ABOVE",
#   },
#   {
#     "category": "HARM_CATEGORY_HATE_SPEECH",
#     "threshold": "BLOCK_MEDIUM_AND_ABOVE",
#   },
#   {
#     "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
#     "threshold": "BLOCK_NONE",
#   },
#   {
#     "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
#     "threshold": "BLOCK_MEDIUM_AND_ABOVE",
#   },
# ]

# model = genai.GenerativeModel(
#   model_name="gemini-1.5-pro",
#   safety_settings=safety_settings,
#   generation_config=generation_config,
# )

# chat_session = model.start_chat(
#   history=[
#     # {
#     #   "role": "user",
#     #   "parts": [
#     #     "Translate and generate the following from Chinese to English for a youtube video ASMR title 木勺吸吸糖｜炼乳｜超好听 and select the most adaptive translation\n",
#     #   ],
#     # },
#   ]
# )
# # Translate and generate the following from Chinese to English for a youtube video ASMR title 木勺吸吸糖｜炼乳｜超好听 and select the most adaptive translation 
# # seems to be the best fit for the AI

# video_title = '木勺吸吸糖｜炼乳｜超好听'
# #change video title to whatever is grabbed from sql
# chat_session.send_message(
#     "Translate and generate the following from Chinese to English for a youtube video ASMR title {video_title} and select the most adaptive translation"
#     )

# print(chat_session.last.text)