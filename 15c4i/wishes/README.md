# 15 C4I Wishes Wall

Guests scan a QR code, write a wish and sign with a finger. Each wish goes to your Telegram with **Approve / Reject** buttons. Approved wishes appear on the TV wall within about 10 seconds, and can be printed as an A1 poster afterwards.

| Page | Address | Use |
|---|---|---|
| Form (QR target) | `https://ur-b20.github.io/fon/15c4i/wishes/` | Guests' phones |
| Wall | `https://ur-b20.github.io/fon/15c4i/wishes/wall.html` | TV / projector laptop. Click once for fullscreen. Add `?demo=1` to preview with sample wishes. |
| Poster | `https://ur-b20.github.io/fon/15c4i/wishes/print.html` | After the event: Print → Save as PDF → A1 |

## One-time setup (about 10 minutes)

1. **Telegram bot.** In Telegram, message `@BotFather`, send `/newbot`, follow the prompts, copy the token it gives you. Open your new bot's chat and press **Start**. (To share approvals with a co-organiser, add the bot to a small group and send one message there instead.)
2. **Google Sheet.** Go to `sheets.new`, name it "15C4I Wishes". Extensions → Apps Script. Delete what is there and paste the whole of `Code.gs` from this folder. Paste your bot token into `TELEGRAM_BOT_TOKEN` at the top. Save.
3. In the toolbar choose the function **setup** and press Run. Accept the permissions prompt (Advanced → Go to project → Allow).
4. Choose **setupTelegram** and press Run. You should receive "15 C4I Wishes Wall connected" on Telegram.
5. **Deploy** → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone** → Deploy. Copy the Web app URL (ends in `/exec`).
6. On GitHub open `15c4i/wishes/config.js`, press the pencil, paste the URL between the quotes, commit to main.
7. Wait a minute for the site to update. Open the form on your phone, post a test wish, tap **Approve** in Telegram, and open the wall page on the TV laptop. The wish should appear within 10 seconds.
8. Generate a QR code for `https://ur-b20.github.io/fon/15c4i/wishes/`.

## During the event

- Every wish arrives on Telegram with the signature image and two buttons. Tap **Approve** or **Reject**. The page that opens confirms it and offers the opposite action if you tapped the wrong one.
- The **Approved** checkbox column in the Sheet is the source of truth. If Telegram is ever down, tick the box there instead.
- If the wall laptop loses connection it keeps showing the last update and a red dot appears next to the status. Tethering to a phone is enough.

## After the event

Open `print.html` on a laptop, wait for "approved wishes loaded", press **Print / Save as PDF**, choose paper size **A1**, turn on **Background graphics**, save. Hand the PDF to the print shop.

## If you edit Code.gs later

Deploy → Manage deployments → pencil → Version: **New version** → Deploy. Saving alone does not update the live URL.
