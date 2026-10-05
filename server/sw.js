// Service worker: makes the site installable and receives "Share to Desk of Madness" from Android.
// Normal requests always go to the network so notes never come from a stale cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share") {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const cache = await caches.open("sn-share");
      await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
      const meta = { title: form.get("title") || "", text: [form.get("text"), form.get("url")].filter(Boolean).join("\n"), files: [] };
      let i = 0;
      for (const file of form.getAll("files")) {
        if (!(file instanceof File)) continue;
        const key = `/share-file/${i++}`;
        meta.files.push({ key, name: file.name, type: file.type });
        await cache.put(key, new Response(file, { headers: { "Content-Type": file.type } }));
      }
      await cache.put("/share-meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
      return Response.redirect("/?shared=1", 303);
    })());
  }
});
