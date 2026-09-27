import decky
import storage


class Plugin:
    async def get_notes(self, appid: str, run_profile_id: str):
        return storage.get_notes(appid, run_profile_id)

    async def save_note(self, appid: str, run_profile_id: str, note: dict):
        return storage.save_note(appid, run_profile_id, note)

    async def delete_note(self, appid: str, run_profile_id: str, note_id: str):
        return storage.delete_note(appid, run_profile_id, note_id)

    async def get_sessions(self, appid: str, run_profile_id: str):
        return storage.get_sessions(appid, run_profile_id)

    async def save_session(self, appid: str, run_profile_id: str, session: dict):
        return storage.save_session(appid, run_profile_id, session)

    async def get_run_profiles(self, appid: str):
        return storage.get_run_profiles(appid)

    async def save_run_profile(self, appid: str, profile: dict):
        return storage.save_run_profile(appid, profile)

    async def list_games_with_notes(self):
        return storage.list_games_with_notes()

    async def get_settings(self):
        return storage.get_settings()

    async def save_settings(self, settings: dict):
        return storage.save_settings(settings)

    async def _main(self):
        decky.logger.info("Session Notes plugin loaded")

    async def _unload(self):
        pass
