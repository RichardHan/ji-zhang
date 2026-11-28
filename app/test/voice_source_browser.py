"""With the app's Vite dev server running, run with Python Playwright and Chrome.

    python app/test/voice_source_browser.py http://127.0.0.1:5173
"""
import json
import sys

from playwright.sync_api import expect, sync_playwright


TRANSCRIPT = "午餐 120"
REPLACEMENT = "車票 350"
AUTH_MODULE = """
export const googleConfigError = () => null
export const isGoogleSignedIn = async () => true
export const signInWithGoogle = async () => ({ email: 'voice@example.test' })
export const signOutGoogle = async () => {}
export const getAccessToken = async () => 'fixture'
export const refreshAccessToken = getAccessToken
"""


def scenario(browser, url, edit, expected_text, expected_label):
    context = browser.new_context(viewport={"width": 393, "height": 852}, is_mobile=True,
                                  permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    prompts, sheet_methods = [], []

    def parse_request(route):
        prompts.append(route.request.post_data_json["messages"][-1]["content"])
        result = {"transactions": [{"date": "今天", "note": "測試", "amount": 120}]}
        route.fulfill(json={"choices": [{"message": {"content": json.dumps(result)}}]})

    def sheets_request(route):
        sheet_methods.append(route.request.method)
        route.fulfill(json={"values": []})

    try:
        page.route("**/src/google/auth.ts*", lambda r: r.fulfill(
            content_type="text/javascript", body=AUTH_MODULE))
        page.route("**/src/speech.ts*", lambda r: r.fulfill(
            content_type="text/javascript", body=f"""
                export const canUseBookkeepingSpeech = true
                export const bookkeepingSpeech = {{
                    recognize: async () => ({{text: {json.dumps(TRANSCRIPT)}}})
                }}
            """))
        page.route("https://openrouter.ai/api/v1/models", lambda r: r.fulfill(json={
            "data": [{"id": "test/text:free", "architecture": {"input_modalities": ["text"]}}]
        }))
        page.route("https://openrouter.ai/api/v1/chat/completions", parse_request)
        page.route("https://sheets.googleapis.com/**", sheets_request)
        page.add_init_script("""
            for (const [key, value] of Object.entries({
                spreadsheet_id: 'test-book', openrouter_api_key: 'fixture',
                google_email: 'voice@example.test'
            })) localStorage.setItem('CapacitorStorage.' + key, value)
        """)
        page.goto(url)
        field = page.get_by_role("textbox", name="用 AI 記帳（TWD）")
        dictate = page.get_by_role("button", name="使用語音輸入")
        dictate.click()
        expect(field).to_have_value(TRANSCRIPT)
        field.focus()
        if edit == "partial":
            field.evaluate("(el) => el.setSelectionRange(el.value.length - 3, el.value.length)")
            page.keyboard.insert_text("150")
        elif edit != "unchanged":
            field.press("ControlOrMeta+a")
            if edit == "paste":
                page.evaluate("(text) => navigator.clipboard.writeText(text)", REPLACEMENT)
                field.press("ControlOrMeta+v")
            elif edit == "ime":
                session = context.new_cdp_session(page)
                session.send("Input.imeSetComposition", {
                    "text": "車", "selectionStart": 1, "selectionEnd": 1,
                })
                session.send("Input.insertText", {"text": REPLACEMENT})
            else:
                if edit == "clear":
                    field.press("Backspace")
                page.keyboard.insert_text(REPLACEMENT)
                if edit == "dictate-again":
                    dictate.click()
        expect(field).to_have_value(expected_text)
        assert prompts == []
        page.get_by_role("button", name="解析並預覽").click()
        expect(page.locator("section h2")).to_have_text(expected_label)
        assert prompts == [expected_text]
        assert sheet_methods and set(sheet_methods) == {"GET"}
        print(f"PASS {edit}: {expected_label}")
    finally:
        context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        for case in [
            ("replace", REPLACEMENT, "AI 文字解析"),
            ("paste", REPLACEMENT, "AI 文字解析"),
            ("ime", REPLACEMENT, "AI 文字解析"),
            ("clear", REPLACEMENT, "AI 文字解析"),
            ("partial", "午餐 150", "語音輸入"),
            ("unchanged", TRANSCRIPT, "語音輸入"),
            ("dictate-again", REPLACEMENT + "\n" + TRANSCRIPT, "語音輸入"),
        ]:
            scenario(browser, sys.argv[1], *case)
        browser.close()
