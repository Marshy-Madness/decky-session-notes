import asyncio

import decky
import storage
from recorder import Recorder
from sync import Sync
from bookstore import Bookstore
from overlay import Overlay


class Plugin:
    recorder = Recorder()
    sync = Sync()
    bookstore = Bookstore()
    overlay = Overlay()

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

    # settings
    async def get_settings(self):
        return storage.get_settings()

    async def save_settings(self, settings: dict):
        return storage.save_settings(settings)

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

    # Bookstore (public library of notes, guides and tips)
    async def bs_games(self, q: str = ""):
        return await asyncio.to_thread(self.bookstore.games, q)

    async def bs_entries(self, params: dict):
        return await asyncio.to_thread(self.bookstore.entries, params)

    async def bs_entry(self, entry_id: str):
        return await asyncio.to_thread(self.bookstore.entry, entry_id)

    async def bs_media(self, file: str):
        return await asyncio.to_thread(self.bookstore.media, file)

    async def bs_start_link(self):
        return await asyncio.to_thread(self.bookstore.start_link)

    async def bs_poll_link(self, device_code: str):
        return await asyncio.to_thread(self.bookstore.poll_link, device_code)

    async def bs_unlink(self):
        return await asyncio.to_thread(self.bookstore.unlink)

    async def bs_like(self, entry_id: str):
        return await asyncio.to_thread(self.bookstore.like, entry_id)

    async def bs_comment(self, entry_id: str, text: str):
        return await asyncio.to_thread(self.bookstore.comment, entry_id, text)

    async def bs_users(self, q: str):
        return await asyncio.to_thread(self.bookstore.users, q)

    async def bs_update(self, entry_id: str, fields: dict):
        return await asyncio.to_thread(self.bookstore.update, entry_id, fields)

    async def bs_publish(self, appid: str, note_id: str, options: dict):
        return await asyncio.to_thread(self.bookstore.publish, appid, note_id, options)

    async def bs_copy(self, entry_id: str, appid: str):
        return await asyncio.to_thread(self.bookstore.copy, entry_id, appid)

    async def _main(self):
        self.sync.task = asyncio.get_event_loop().create_task(self.sync.auto_loop())
        self.overlay.task = asyncio.get_event_loop().create_task(self.overlay.loop())
        decky.logger.info("Session Notes plugin loaded")

    async def _unload(self):
        if self.sync.task:
            self.sync.task.cancel()
        if self.overlay.task:
            self.overlay.task.cancel()
        self.overlay.clear()
        await self.recorder.stop()
