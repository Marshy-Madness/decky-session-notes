import asyncio
import os
import re

import decky
import migrate

migrate.run()  # before storage reads anything: brings Session Notes data across on first start

import storage  # noqa: E402
from recorder import Recorder
from sync import Sync, _SSL as SSL_CONTEXT
from workshop import Workshop
from overlay import Overlay
from buttons import Buttons
import reader
import screenshot


DICTATION_PATH = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "dictation.wav")
VOICE_SHOT_PATH = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "voice-shot.png")
BACKDROP_PATH = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "overlay-backdrop.png")


class Plugin:
    recorder = Recorder()
    dictation = Recorder()  # separate from voice notes, so the button combo works with an editor open
    sync = Sync()
    workshop = Workshop()
    overlay = Overlay()
    buttons = Buttons()

    # games / launches
    async def list_games(self):
        return storage.list_games()

    async def get_game(self, appid: str):
        return storage.get_game(appid)

    async def record_launch(self, appid: str, name: str):
        return storage.record_launch(appid, name)

    async def record_exit(self, appid: str):
        pin = storage.get_settings().get("overlayPin") or {}
        if pin.get("appId") == appid:
            await self.unpin_overlay()
        return storage.record_exit(appid)

    async def ensure_game(self, appid: str, name: str):
        return storage.ensure_game(appid, name)

    # notes / folders
    async def save_note(self, appid: str, note: dict):
        saved = storage.save_note(appid, note)
        self._refresh_overlay(appid, note["id"])
        return saved

    def _refresh_overlay(self, appid: str, note_id: str):
        pin = storage.get_settings().get("overlayPin") or {}
        if pin.get("appId") == appid and pin.get("noteId") == note_id:
            note = next((n for n in storage.load_game(appid).get("notes", []) if n["id"] == note_id), None)
            self.overlay.set_note(note)

    # on-screen to-do pin (experimental, uses the performance overlay)
    async def pin_overlay(self, appid: str, note_id: str):
        settings = storage.get_settings()
        settings["overlayPin"] = {"appId": appid, "noteId": note_id}
        storage.save_settings(settings)
        self._refresh_overlay(appid, note_id)
        return self.overlay.status()

    async def unpin_overlay(self):
        settings = storage.get_settings()
        settings.pop("overlayPin", None)
        storage.save_settings(settings)
        self.overlay.clear()
        return self.overlay.status()

    async def overlay_status(self):
        return {**self.overlay.status(), "pin": storage.get_settings().get("overlayPin")}

    async def overlay_preview(self, appid: str = ""):
        """The lines the overlay shows (or would show), for the placement preview: the pinned note, else the
        game's most recently edited checklist, else an example."""
        if self.overlay.lines:
            return {"lines": self.overlay.lines, "source": "pinned"}
        if appid:
            notes = [n for n in storage.load_game(appid).get("notes", []) if n.get("checklist")]
            if notes:
                note = max(notes, key=lambda n: n.get("updatedAt", 0))
                return {"lines": self.overlay.render(note), "source": "note"}
        sample = {"title": "To do", "checklist": [{"text": "Find the key"}, {"text": "Beat the boss"},
                                                 {"text": "Talk to the blacksmith", "done": True}]}
        return {"lines": self.overlay.render(sample), "source": "sample"}

    async def delete_note(self, appid: str, note_id: str):
        return storage.delete_note(appid, note_id)

    async def get_note_history(self, appid: str, note_id: str):
        return storage.get_note_history(appid, note_id)

    async def list_deleted_notes(self, appid: str):
        return storage.list_deleted_notes(appid)

    async def restore_note(self, appid: str, note: dict):
        return storage.restore_note(appid, note)

    async def save_folder(self, appid: str, folder: dict):
        return storage.save_folder(appid, folder)

    async def delete_folder(self, appid: str, folder_id: str):
        return storage.delete_folder(appid, folder_id)

    async def set_left_off(self, appid: str, text: str):
        return storage.set_left_off(appid, text)

    # counters
    async def save_counter(self, appid: str, counter: dict):
        return storage.save_counter(appid, counter)

    async def bump_counter(self, appid: str, counter_id: str, delta: int):
        return storage.bump_counter(appid, counter_id, delta)

    async def delete_counter(self, appid: str, counter_id: str):
        return storage.delete_counter(appid, counter_id)

    # media
    async def find_new_screenshot(self, appid: str, after_ms: int):
        return storage.find_new_screenshot(appid, after_ms)

    async def list_steam_screenshots(self, appid: str, limit: int = 30):
        return storage.list_steam_screenshots(appid, limit)

    async def attach_screenshot(self, appid: str, path: str):
        return storage.attach_screenshot(appid, path)

    async def save_media_data(self, appid: str, b64: str, ext: str):
        return storage.save_media_data(appid, b64, ext)

    async def get_media(self, appid: str, filename: str):
        return storage.get_media(appid, filename)

    async def delete_media(self, appid: str, item: dict):
        return storage.delete_media(appid, item)

    async def start_recording(self, appid: str):
        return await self.recorder.start(appid)

    async def stop_recording(self):
        return await self.recorder.stop()

    # speech to text (done by the sync server, if its owner allowed this account)
    async def speech_status(self, refresh: bool = False):
        return {"allowed": await asyncio.to_thread(self.sync.speech_allowed, refresh)}

    async def start_dictation(self):
        if os.path.exists(DICTATION_PATH):
            os.remove(DICTATION_PATH)
        await self.dictation.start_to(DICTATION_PATH)
        return True

    async def stop_dictation(self, appid: str = "", game: str = ""):
        """Stop listening and return the words ("" if nothing was said)."""
        if not await self.dictation.stop():
            return ""
        try:
            return await asyncio.to_thread(self.sync.transcribe, DICTATION_PATH, appid, game)
        finally:
            if os.path.exists(DICTATION_PATH):
                os.remove(DICTATION_PATH)

    async def cancel_dictation(self):
        await self.dictation.stop()
        if os.path.exists(DICTATION_PATH):
            os.remove(DICTATION_PATH)

    # screenshots for voice commands, taken the moment the voice combo is pressed
    async def capture_screen(self):
        """Takes a screenshot and keeps it aside until a command uses or discards it. Returns an error or ""."""
        try:
            await screenshot.capture(VOICE_SHOT_PATH)
            return ""
        except Exception as e:
            decky.logger.warning(f"Screenshot failed: {e}")
            return str(e)

    async def attach_captured(self, appid: str):
        if not os.path.exists(VOICE_SHOT_PATH):
            return None
        return screenshot.attach(appid, VOICE_SHOT_PATH)

    async def discard_captured(self):
        if os.path.exists(VOICE_SHOT_PATH):
            os.remove(VOICE_SHOT_PATH)

    # a throwaway screenshot of the game behind the pin-to-screen modal, deleted when the modal closes
    async def capture_backdrop(self):
        """Returns the game's screen as a data URL, or None if gamescope didn't take one."""
        try:
            await screenshot.capture(BACKDROP_PATH)
            screenshot.forget_gamescope_shot()
            return storage.data_url(BACKDROP_PATH)
        except Exception as e:
            decky.logger.warning(f"Backdrop screenshot failed: {e}")
            return None

    async def discard_backdrop(self):
        if os.path.exists(BACKDROP_PATH):
            os.remove(BACKDROP_PATH)

    async def transcribe_recording(self, appid: str, file: str):
        text = await asyncio.to_thread(self.sync.transcribe_media, appid, file)
        if text:
            storage.set_transcript(appid, file, text)
        return text

    # settings
    async def get_settings(self):
        return storage.get_settings()

    async def save_settings(self, settings: dict):
        # The panel doesn't track the on-screen pin; keep the one we stored.
        pin = storage.get_settings().get("overlayPin")
        settings = {k: v for k, v in settings.items() if k != "overlayPin"}
        if pin:
            settings["overlayPin"] = pin
        result = storage.save_settings(settings)
        self._style_overlay(settings)
        return result

    def _style_overlay(self, settings: dict):
        self.overlay.set_style(settings)

    # two-way sync with the server container
    async def sync_now(self):
        return await self.sync.sync()

    async def pair_device(self, code: str):
        return await asyncio.to_thread(self.sync.pair, code)

    async def server_users(self):
        return await asyncio.to_thread(self.sync.users)

    async def note_shares(self, appid: str, note_id: str):
        return await asyncio.to_thread(self.sync.note_shares, appid, note_id)

    async def share_note(self, appid: str, note_id: str, to: str):
        return await asyncio.to_thread(self.sync.share, appid, note_id, to)

    async def unshare_note(self, share_id: str):
        return await asyncio.to_thread(self.sync.unshare, share_id)

    async def copy_shared_note(self, appid: str, share_id: str):
        return storage.copy_shared_note(appid, share_id)

    async def test_backup_server(self):
        return await self.sync.test()

    async def backup_status(self):
        return self.sync.status()

    # reader view for links in notes: made and cached by the server, or right here if there's no server
    async def reader_page(self, url: str, refresh: bool = False):
        def run():
            if storage.get_settings().get("syncUrl"):
                try:
                    return {**self.sync.reader_page(url, refresh), "source": "server"}
                except RuntimeError as e:
                    # The server already tried the site; only an unreachable or older server is worth retrying here.
                    if not re.search(r"Server error (404|5\d\d)|Can't reach|No server|rejected", str(e)):
                        raise
            try:
                return {**reader.extract(url, context=SSL_CONTEXT), "cached": False, "source": "device"}
            except ValueError as e:
                raise RuntimeError(str(e))
        return await asyncio.to_thread(run)

    async def reader_settings(self):
        if not storage.get_settings().get("syncUrl"):
            return None
        return await asyncio.to_thread(self.sync.reader_settings)

    async def set_reader_cache_days(self, days: int):
        return await asyncio.to_thread(self.sync.set_reader_cache_days, days)

    async def clear_reader_cache(self):
        return await asyncio.to_thread(self.sync.clear_reader_cache)

    # Workshop (public library of notes, guides and tips)
    async def bs_games(self, q: str = ""):
        return await asyncio.to_thread(self.workshop.games, q)

    async def bs_entries(self, params: dict):
        return await asyncio.to_thread(self.workshop.entries, params)

    async def bs_entry(self, entry_id: str):
        return await asyncio.to_thread(self.workshop.entry, entry_id)

    async def bs_media(self, file: str):
        return await asyncio.to_thread(self.workshop.media, file)

    async def bs_start_link(self):
        return await asyncio.to_thread(self.workshop.start_link)

    async def bs_poll_link(self, device_code: str):
        return await asyncio.to_thread(self.workshop.poll_link, device_code)

    async def bs_unlink(self):
        return await asyncio.to_thread(self.workshop.unlink)

    async def bs_like(self, entry_id: str):
        return await asyncio.to_thread(self.workshop.like, entry_id)

    async def bs_comment(self, entry_id: str, text: str):
        return await asyncio.to_thread(self.workshop.comment, entry_id, text)

    async def bs_users(self, q: str):
        return await asyncio.to_thread(self.workshop.users, q)

    async def bs_update(self, entry_id: str, fields: dict):
        return await asyncio.to_thread(self.workshop.update, entry_id, fields)

    async def bs_publish(self, appid: str, note_id: str, options: dict):
        return await asyncio.to_thread(self.workshop.publish, appid, note_id, options)

    async def bs_copy(self, entry_id: str, appid: str):
        return await asyncio.to_thread(self.workshop.copy, entry_id, appid)

    async def import_notice(self):
        return migrate.take_notice()

    async def buttons_status(self):
        return self.buttons.status()

    async def _main(self):
        self.sync.task = asyncio.get_event_loop().create_task(self.sync.auto_loop())
        self._style_overlay(storage.get_settings())
        self.overlay.task = asyncio.get_event_loop().create_task(self.overlay.loop())
        self.buttons.task = asyncio.get_event_loop().create_task(self.buttons.loop())
        decky.logger.info("Desk of Madness plugin loaded")

    async def _unload(self):
        if self.sync.task:
            self.sync.task.cancel()
        if self.overlay.task:
            self.overlay.task.cancel()
        if self.buttons.task:
            self.buttons.task.cancel()
        self.overlay.clear()
        await self.recorder.stop()
        await self.dictation.stop()
        await self.discard_backdrop()
