# Local audit checks

Run `npm test` for unit and controller checks. Run `npm run test:local-db` for temporary-table checks against the local restored `mh-17-10` database. Run `npm run test:local-http` for real HTTP/JWT checks using a loopback-only test issuer and read-only local database access. Both integration scripts refuse non-loopback database targets. No production testing is included.

API clients must supply access tokens in the Authorization bearer header. Tokens in URLs are rejected, and request logs exclude query strings.

Service metrics combine all mapped categories before calculating totals and percentiles. API drilldowns retain their category scope. Services without provider requests remain hidden from Service Performance; their captured calls remain available in Individual APIs.

Error and feedback reporting use the event occurrence timestamp, displayed and grouped in IST. Ratings count even when comments are absent. Headline answered-question counts exclude empty answers; underlying question-only events are retained.
