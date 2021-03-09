"use strict";

const version = "20210309::";

// Caches for different resources
const core_cache_name = version + "core";
const pages_cache_name = version + "pages";
const assets_cache_name = version + "assets";

// Resources that will be always be cached
const core_cache_urls = [
    "/",
    "/offline",
    "/styles/main.css",
    "/styles/index.css",
    "/styles/known_kanji.css",
    "/styles/quiz.css",
    "/styles/custom_text.css",
    "/scripts/jquery-3.5.1.min.js",
    "/scripts/ds.min.js",
    "/scripts/known_kanji.js",
    "/scripts/quiz.js",
    "/fonts/SourceSansPro-Regular.ttf",
    "/fonts/MaterialIcons-Round.woff2",
    "/fonts/Cantarell-Bold.ttf",
    "/scripts/custom_text.js",
    "/favicon-32x32.png",
];

function update_core_cache() {
    return caches.open(core_cache_name)
        .then(cache => {
            // Make installation contingent on storing core cache items
            return cache.addAll(core_cache_urls);
        });
}

function add_to_cache(cache_name, request, response) {
    caches.open(cache_name).then(cache => cache.put(request, response));
}

// Trim specified cache to max size
function trimCache(cacheName, maxItems) {
    caches.open(cacheName).then(function(cache) {
        cache.keys().then(function(keys) {
            if (keys.length > maxItems) {
                cache.delete(keys[0]).then(trimCache(cacheName, maxItems));
            }
        });
    });
}

// Remove old caches that don't match current version
function clear_caches() {
    return caches.keys().then(function(keys) {
        return Promise.all(keys.filter(function(key) {
                return key.indexOf(version) !== 0;
            }).map(function(key) {
                return caches.delete(key);
            })
        );
    })
}

// Check if request is something SW should handle
function should_fetch(event) {
    let request = event.request,
        pathPattern = /^\/(.*)?$/,
        url = new URL(request.url);

    return (request.method === "GET" &&
        !!(pathPattern.exec(url.pathname)) &&
        url.origin === self.location.origin);
}

self.addEventListener("install", event => {
    event.waitUntil(update_core_cache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(
        clear_caches().then(() => {
            return self.clients.claim();
        })
    );
});

self.addEventListener("message", event => {
    if (event.data.command === "trim_caches") {
        trimCache(pages_cache_name, 20);
        trimCache(assets_cache_name, 20);
    }
});

self.addEventListener("fetch", event => {
    let request = event.request,
        acceptHeader = request.headers.get("Accept");

    // Do not respond to non-GET requests
    if (!should_fetch(event)) {
        return;
    }

    if (acceptHeader.indexOf("text/html") !== -1) {
        // HTML Requests
        // Try network first
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok)
                        add_to_cache(pages_cache_name, request, response.clone());
                    return response;
                })
                // Try cache second with offline fallback
                .catch(() => {
                    return caches.match(request).then(response => {
                        return response || caches.match("/offline");
                    })
                })
        );
    } else if (acceptHeader.indexOf("text/html") === -1) {
        // Non-HTML Requests
        event.respondWith(
            caches.match(request)
                .then(response => {
                    // Try cache, then network, then offline fallback
                    return response || fetch(request)
                        .then(response => {
                            if (response.ok)
                                add_to_cache(assets_cache_name, request, response.clone());
                            return response;
                        })
                        /*.catch(() => {
                            return new Response('<svg role="img" aria-labelledby="offline-title" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg"><title id="offline-title">Offline</title><g fill="none" fill-rule="evenodd"><path fill="#D8D8D8" d="M0 0h400v300H0z"/><text fill="#9B9B9B" font-family="Helvetica Neue,Arial,Helvetica,sans-serif" font-size="72" font-weight="bold"><tspan x="93" y="172">offline</tspan></text></g></svg>', { headers: { 'Content-Type': 'image/svg+xml' }});
                        })*/
                })
        );
    }
});
