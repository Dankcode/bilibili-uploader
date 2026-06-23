import os
import sys

from openai import OpenAI


PROVIDERS = {
    "codex": {
        "api_key_env": "OPENAI_API_KEY",
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-5.5",
        "base_url": None,
    },
    "kimi": {
        "api_key_env": "KIMI_API_KEY",
        "model_env": "KIMI_MODEL",
        "default_model": "moonshot-v1-8k",
        "base_url": os.getenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1"),
    },
}


def provider_config():
    provider_name = os.getenv("AI_PROVIDER", "codex").lower()
    provider = PROVIDERS.get(provider_name)

    if provider is None:
        raise ValueError(f'Unsupported AI_PROVIDER "{provider_name}". Use "codex" or "kimi".')

    api_key = os.getenv(provider["api_key_env"])
    if not api_key:
        raise ValueError(f'Missing {provider["api_key_env"]} for AI_PROVIDER={provider_name}.')

    return {
        "provider_name": provider_name,
        "api_key": api_key,
        "base_url": provider["base_url"],
        "model": os.getenv(provider["model_env"], provider["default_model"]),
    }


def generate_title(video_title):
    config = provider_config()
    client = OpenAI(
        api_key=config["api_key"],
        base_url=config["base_url"],
    )

    completion = client.chat.completions.create(
        model=config["model"],
        messages=[
            {
                "role": "system",
                "content": (
                    "Rewrite, summarize, and translate Chinese video titles into natural "
                    "English YouTube ASMR titles. Return only the title."
                ),
            },
            {"role": "user", "content": video_title},
        ],
        temperature=0.3,
    )
    return completion.choices[0].message.content


if __name__ == "__main__":
    title = sys.argv[1] if len(sys.argv) > 1 else "【泡饭助眠】不同的刷子来刷你的脸部各种部位｜轻语｜带走你的疲惫"
    print(generate_title(title))
