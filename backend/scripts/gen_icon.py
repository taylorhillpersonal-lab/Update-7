import asyncio, os, base64, pathlib
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv()
OUT = pathlib.Path("/app/backend/scripts/_icon_raw.png")

PROMPT = (
    "Design a premium mobile GAME APP ICON for an idle business tycoon game. "
    "A bold golden royal crown sitting on top of a stylized cluster of modern "
    "city skyscrapers, with a small stack of gold coins at the base. "
    "Rich metallic gold emblem with subtle highlights, centered, perfectly "
    "symmetrical, on a deep navy-to-black radial gradient background with a soft "
    "warm glow behind the crown. Flat modern vector illustration, clean thick "
    "shapes, high contrast, crisp edges, app-store quality, 1:1 square. "
    "ABSOLUTELY NO TEXT, no letters, no words, no numbers anywhere in the image."
)

async def main():
    api_key = os.getenv("EMERGENT_LLM_KEY")
    chat = LlmChat(api_key=api_key, session_id="idle-tycoon-icon", system_message="You are a world-class app icon designer.")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    text, images = await chat.send_message_multimodal_response(UserMessage(text=PROMPT))
    print("text:", (text or "")[:80])
    if not images:
        raise SystemExit("No image returned")
    image_bytes = base64.b64decode(images[0]["data"])
    OUT.write_bytes(image_bytes)
    print("saved raw icon:", OUT, len(image_bytes), "bytes", images[0]["mime_type"])

asyncio.run(main())
